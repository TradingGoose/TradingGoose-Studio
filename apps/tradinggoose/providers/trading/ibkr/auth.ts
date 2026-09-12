import { resolveIbkrApiBaseUrl, resolveIbkrApiIp } from '@/providers/trading/ibkr/config'

/**
 * IBKR exposes two different surfaces with incompatible auth:
 *
 *  - Client Portal Gateway (local, the default here): the session is
 *    established by logging in through the browser at the gateway's own URL.
 *    Requests carry that session implicitly; there is NO bearer token, and
 *    sending an Authorization header is simply ignored. Requiring a token here
 *    is what made every market-data call fail before a request was even sent.
 *  - Hosted OAuth API (api.ibkr.com): bearer token, plus the originating `ip`.
 *
 * We pick by base URL rather than by a flag so the two can never disagree.
 */
const IBKR_HOSTED_HOST = /(^|\.)api\.ibkr\.com$/i

/**
 * The canonical hosted URL is `https://api.ibkr.com/v1/api`, whose host is
 * preceded by `//`. A `(^|\.)` anchored pattern never matches that form, which
 * silently disabled the hosted branch below and stripped the bearer token from
 * every hosted request. Match the parsed hostname instead, and keep a substring
 * fallback for values that are not absolute URLs.
 */
export const isIbkrHostedApi = (): boolean => {
  const base = resolveIbkrApiBaseUrl()
  try {
    return IBKR_HOSTED_HOST.test(new URL(base).hostname)
  } catch {
    return /api\.ibkr\.com/i.test(base)
  }
}

export const buildIbkrAuthHeaders = (
  params: { accessToken?: string } = {}
): Record<string, string> => {
  if (!isIbkrHostedApi()) {
    // Gateway mode: the session cookie does the work. Nothing to add.
    return { Accept: 'application/json' }
  }

  if (!params.accessToken) {
    throw new Error('IBKR hosted API requires an access token')
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${params.accessToken}`,
    ip: resolveIbkrApiIp(),
  }
}
