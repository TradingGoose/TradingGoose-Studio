import { resolveIbkrApiBaseUrl } from '@/providers/trading/ibkr/config'

export const buildIbkrApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${resolveIbkrApiBaseUrl()}${normalizedPath}`
}

export const buildIbkrAccountUrl = (accountId: string, path: string): string =>
  buildIbkrApiUrl(`/portfolio/${encodeURIComponent(accountId)}${path}`)

/**
 * In-memory cache for IBKR security definition lookups (symbol -> conid).
 * The Client Portal Web API is conid-centric; caching avoids repeated
 * /iserver/secdef/search calls and reduces exposure to IBKR pacing limits.
 */
const conidCache = new Map<string, number>()

export const cacheIbkrConid = (key: string, conid: number): void => {
  conidCache.set(key, conid)
}

export const getCachedIbkrConid = (key: string): number | undefined => conidCache.get(key)

export const clearIbkrConidCache = (): void => {
  conidCache.clear()
}
