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
 * The app cannot re-authenticate the gateway by itself - only a browser login at
 * the gateway's own URL can - so this must read as the instruction it is rather
 * than a bare "Broker request failed with status 401" that looks like a
 * provider bug.
 *
 * It deliberately names no URL: the gateway's scheme and port are
 * deployment-specific (this deployment listens on plain HTTP behind a
 * portproxy), and naming the wrong one sends the operator to a port that is not
 * listening.
 */
export const IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE =
  'IBKR Client Portal Gateway session is not authenticated. Log in at the gateway URL ' +
  'in a browser on the host that runs it, then retry; the app cannot ' +
  're-authenticate the gateway.'

const readBrokerStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
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
      // The same condition the data endpoints report as 401, so it gets the
      // same message and the same cache reset as the priming path below.
      resetIbkrSessionState()
      throw new Error(IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE)
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
      await fetchBrokerJson<unknown>({
        providerId: 'ibkr',
        url: buildIbkrApiUrl('/iserver/accounts'),
        init: { method: 'GET', headers },
      })
      accountsPrimed = true
    } catch (error) {
      const status = readBrokerStatus(error)
      if (status === 401 || status === 403) {
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
