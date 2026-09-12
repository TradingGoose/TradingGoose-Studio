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
 * The gateway reports an unauthenticated or lapsed session as 401 (403 on some
 * builds). The app cannot re-authenticate the gateway by itself - that requires
 * a browser login at the gateway's own URL - so this case must be reported as
 * the actionable instruction it is, not as a bare "Broker request failed with
 * status 401" that reads like a bug in the provider.
 */
export const IBKR_GATEWAY_SESSION_EXPIRED_MESSAGE =
  'IBKR Client Portal Gateway session is not authenticated. Log in at the gateway URL ' +
  '(default https://localhost:5001) and retry; the app cannot re-authenticate the gateway.'

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
      throw new Error(
        'IBKR Gateway session is not authenticated. Log in at the gateway URL ' +
          '(default https://localhost:5000) and retry.'
      )
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
