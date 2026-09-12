import { createLogger } from '@/lib/logs/console/logger'
import { buildIbkrAuthHeaders, isIbkrHostedApi } from '@/providers/trading/ibkr/auth'
import { buildIbkrApiUrl } from '@/providers/trading/ibkr/client'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

const logger = createLogger('IBKR:Session')

/**
 * The Client Portal Gateway drops an idle session after a few minutes, and it
 * will not serve /iserver/* data until /iserver/accounts has been called once
 * for the session. Both are cheap, so we do them on a timer rather than
 * discovering the problem as an opaque 401 halfway through a chart load.
 */
const TICKLE_INTERVAL_MS = 60_000
let lastTickleAt = 0
let accountsPrimed = false

interface IbkrAuthStatus {
  authenticated?: boolean
  connected?: boolean
  competing?: boolean
}

interface IbkrReauthenticateResult {
  authenticated?: boolean
  pass?: boolean
  passed?: boolean
}

type IbkrAuthHeaders = ReturnType<typeof buildIbkrAuthHeaders>

export const resetIbkrSessionState = (): void => {
  lastTickleAt = 0
  accountsPrimed = false
}

/**
 * An unauthenticated or lapsed gateway session surfaces two ways: as
 * `authenticated: false` on /iserver/auth/status, and as 401 on the data
 * endpoints. Both are the same condition for the operator, so both report this
 * one message.
 *
 * The app asks the gateway to restore the session itself first
 * (see tryReauthenticate), so reaching this message means even that failed and
 * there is no browser login to build on.
 *
 * It deliberately names no URL: the gateway's scheme and port are
 * deployment-specific (this deployment listens on plain HTTP behind a
 * portproxy), and naming the wrong one sends the operator to a port that is not
 * listening.
 */
export const IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE =
  'IBKR Client Portal Gateway session is not authenticated and could not be ' +
  'restored automatically. Log in at the gateway URL in a browser on the host ' +
  'that runs it, then retry.'

const readBrokerStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

/**
 * A browser login only establishes the SSO half of the session; the brokerage
 * (iserver) half is established separately, and until something completes it the
 * gateway keeps reporting `authenticated:false` while its SSO is perfectly
 * valid. This call is what completes it - observed live, the gateway logging
 * `iserver init : {"passed":true,"authenticated":true,"connected":true,...}`
 * immediately after it.
 *
 * It also explains the "you have to click Log In twice" symptom: clicking again
 * can never work, because the gateway answers the second login with
 * `{"message":"sso dh already set"}` and logs `ssodh failed, retry with
 * /iserver/reauthenticate`. That logged instruction is what this implements
 * (IBKR's documented order is reauthenticate first, then validate the SSO).
 */
const tryReauthenticate = async (headers: IbkrAuthHeaders): Promise<boolean> => {
  const result = await fetchBrokerJson<IbkrReauthenticateResult>({
    providerId: 'ibkr',
    url: buildIbkrApiUrl('/iserver/reauthenticate'),
    init: { method: 'POST', headers },
  }).catch((error) => {
    logger.warn('IBKR reauthenticate failed', { error })
    return null
  })

  if (!result) return false

  // Gateway builds disagree on the body shape, so take an explicit verdict when
  // one is present and otherwise ask the status endpoint the caller depends on.
  const verdict = result.authenticated ?? result.passed ?? result.pass
  if (verdict === true) return true
  if (verdict === false) return false

  const status = await fetchBrokerJson<IbkrAuthStatus>({
    providerId: 'ibkr',
    url: buildIbkrApiUrl('/iserver/auth/status'),
    init: { method: 'POST', headers },
  }).catch(() => null)

  return status?.authenticated === true
}

/**
 * Priming, not data: the gateway serves 401 on /iserver/* until this has been
 * called once for the session.
 */
const primeIbkrAccounts = async (headers: IbkrAuthHeaders): Promise<void> => {
  await fetchBrokerJson<unknown>({
    providerId: 'ibkr',
    url: buildIbkrApiUrl('/iserver/accounts'),
    init: { method: 'GET', headers },
  })
}

export async function ensureIbkrSession(params: { accessToken?: string } = {}): Promise<void> {
  // The hosted OAuth API is stateless; none of this applies.
  if (isIbkrHostedApi()) return

  const headers = buildIbkrAuthHeaders(params)
  const now = Date.now()

  if (now - lastTickleAt > TICKLE_INTERVAL_MS) {
    const status = await fetchBrokerJson<IbkrAuthStatus>({
      providerId: 'ibkr',
      url: buildIbkrApiUrl('/iserver/auth/status'),
      init: { method: 'POST', headers },
    }).catch((error) => {
      logger.warn('IBKR auth status check failed', { error })
      return null
    })

    if (status && status.authenticated === false) {
      // Let the gateway rebuild its brokerage session before telling the
      // operator to do something they already did.
      if (await tryReauthenticate(headers)) {
        logger.info('IBKR gateway session restored via reauthenticate', {})
        resetIbkrSessionState()
      } else {
        resetIbkrSessionState()
        throw new Error(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
      }
    }

    await fetchBrokerJson<unknown>({
      providerId: 'ibkr',
      url: buildIbkrApiUrl('/tickle'),
      init: { method: 'POST', headers },
    }).catch((error) => logger.warn('IBKR tickle failed', { error }))

    lastTickleAt = now
  }

  if (!accountsPrimed) {
    try {
      await primeIbkrAccounts(headers)
      accountsPrimed = true
    } catch (error) {
      const status = readBrokerStatus(error)
      if (status === 401 || status === 403) {
        // The data endpoints report the same condition as auth/status, so the
        // gateway gets the same one shot at rebuilding the session here.
        if (await tryReauthenticate(headers)) {
          try {
            await primeIbkrAccounts(headers)
            accountsPrimed = true
            return
          } catch (retryError) {
            logger.warn('IBKR accounts priming failed after reauthenticate', {
              error: retryError,
            })
          }
        }
        // Drop the cached state so the next attempt primes from scratch once
        // the operator has logged in at the gateway.
        resetIbkrSessionState()
        throw new Error(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
      }
      // Priming is a precondition, not the data the caller asked for, so a
      // transient failure here must not fail the request: observed a 400 while
      // the gateway was mid-login, where the subsequent call succeeds. Leave
      // accountsPrimed false so the next request retries.
      logger.warn('IBKR accounts priming failed; continuing without caching success', { error })
    }
  }
}
