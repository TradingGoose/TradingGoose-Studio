import { createHash } from 'crypto'
import { readServerJsonCache, writeServerJsonCache } from '@/lib/cache/server-json-cache'
import { MARKET_API_URL_DEFAULT } from '@/lib/market/client/constants'
import { resolveMarketApiServiceConfig } from '@/lib/system-services/runtime'

const CACHE_PREFIX = 'market:request:v1:'
const CACHE_TTL_SECONDS = 60 * 5
const STRIP_CACHED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding'])
const inFlight = new Map<string, Promise<CachedMarketResponse>>()

type CachedMarketResponse = {
  body: string
  headers: Array<[string, string]>
  status: number
}

export type TradingGooseMarketRequestInit = RequestInit & {
  apiKey?: string | null
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const cacheKeyForUrl = (rawUrl: string) => {
  const url = new URL(rawUrl)
  const sortedParams = new URLSearchParams(
    Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey)
      return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison
    })
  )
  url.search = sortedParams.toString()
  return `${CACHE_PREFIX}${hash(url.toString())}`
}

const isCacheable = (url: string, method: string) => {
  if (method !== 'GET') return false
  const pathname = new URL(url).pathname
  return (
    pathname === '/api/search' ||
    pathname.startsWith('/api/search/') ||
    pathname === '/api/get' ||
    pathname.startsWith('/api/get/')
  )
}

const toResponse = (cached: CachedMarketResponse) =>
  new Response(cached.body, {
    headers: new Headers(cached.headers),
    status: cached.status,
  })

const toCachedResponse = async (response: Response): Promise<CachedMarketResponse> => ({
  body: await response.text(),
  headers: Array.from(response.headers.entries()).filter(
    ([key]) => !STRIP_CACHED_HEADERS.has(key.toLowerCase())
  ),
  status: response.status,
})

export async function requestTradingGooseMarket(
  endpoint: string,
  init: TradingGooseMarketRequestInit = {}
): Promise<Response> {
  const { apiKey, headers, method: rawMethod = 'GET', ...rest } = init
  const method = rawMethod.toUpperCase()
  const marketApi = await resolveMarketApiServiceConfig()
  const url = new URL(endpoint, marketApi.baseUrl || MARKET_API_URL_DEFAULT).toString()
  const requestHeaders = new Headers(headers)
  const resolvedApiKey = apiKey === undefined ? marketApi.apiKey : apiKey

  if (!requestHeaders.get('content-type')) requestHeaders.set('content-type', 'application/json')
  if (resolvedApiKey) requestHeaders.set('x-api-key', resolvedApiKey)
  else requestHeaders.delete('x-api-key')

  const requestInit: RequestInit = { ...rest, cache: 'no-store', headers: requestHeaders, method }
  if (!isCacheable(url, method)) return fetch(url, requestInit)

  const cacheKey = cacheKeyForUrl(url)
  const cached = await readServerJsonCache<CachedMarketResponse>(cacheKey)
  if (cached) return toResponse(cached)

  const pending = inFlight.get(cacheKey)
  if (pending) return toResponse(await pending)

  const request = (async () => {
    const response = await fetch(url, requestInit)
    const cachedResponse = await toCachedResponse(response)
    if (response.ok) await writeServerJsonCache(cacheKey, cachedResponse, CACHE_TTL_SECONDS)
    return cachedResponse
  })()

  inFlight.set(cacheKey, request)
  try {
    return toResponse(await request)
  } finally {
    inFlight.delete(cacheKey)
  }
}
