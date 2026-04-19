import { createHash } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { readServerJsonCache, writeServerJsonCache } from '@/lib/cache/server-json-cache'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'
import { resolveMarketApiServiceConfig } from '@/lib/system-services/runtime'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketProxyAPI')
const MARKET_SEARCH_CACHE_PREFIX = 'market:search:'
const MARKET_SEARCH_CACHE_TTL_SECONDS = 60 * 5

type CachedSearchResponse = {
  body: string
  contentType: string | null
  status: number
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const normalizeVersion = (raw: string | null) => {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^v?(\d+)(?:\.(\d+))?$/i)
  if (!match) return null
  const major = match[1]
  return `v${major}`
}

const resolveVersion = (body: unknown, params?: URLSearchParams | null) => {
  const queryVersion = params?.get('version') ?? null
  const raw =
    queryVersion ??
    (typeof body === 'object' && body !== null && 'version' in body
      ? String((body as { version?: unknown }).version ?? '')
      : '')
  return normalizeVersion(raw || MARKET_API_VERSION)
}

const buildSearchCacheKey = (targetUrl: string) =>
  `${MARKET_SEARCH_CACHE_PREFIX}${createHash('sha256').update(targetUrl).digest('hex')}`

const buildSearchCacheTarget = (
  pathSegments: string[] | undefined,
  params: URLSearchParams
) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const search = params.toString()
  return `/api${path}${search ? `?${search}` : ''}`
}

const buildTargetUrl = (
  marketApiUrl: string,
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const target = new URL(`/api${path}`, marketApiUrl)
  if (overrideSearchParams) {
    const search = overrideSearchParams.toString()
    target.search = search ? `?${search}` : ''
  } else {
    target.search = request.nextUrl.search ?? ''
  }
  return target.toString()
}

const buildForwardHeaders = (request: NextRequest, apiKey: string | null) => {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  if (apiKey) {
    headers.set('x-api-key', apiKey)
  }
  if (!headers.get('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return headers
}

export const proxyMarketRequest = async (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const requestId = generateRequestId()
  let bodyPayload: Record<string, unknown> = {}
  try {
    const parsed = await request.clone().json()
    if (parsed && typeof parsed === 'object') {
      bodyPayload = parsed as Record<string, unknown>
    }
  } catch {
    bodyPayload = {}
  }
  const version = resolveVersion(bodyPayload, overrideSearchParams ?? request.nextUrl.searchParams)
  if (!version) {
    return NextResponse.json({ error: 'Invalid API version' }, { status: 400 })
  }

  try {
    const method = request.method.toUpperCase()
    const scope = pathSegments?.[0]
    const isSearch = scope === 'search'
    const isUpdate = scope === 'update'
    const isGet = scope === 'get'
    const isValidate = scope === 'validate-key'

    if (!pathSegments || (!isSearch && !isUpdate && !isGet && !isValidate)) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }
    const allowMethod =
      (isSearch && method === 'GET') ||
      (isGet && method === 'GET') ||
      (isUpdate && method === 'POST') ||
      (isValidate && (method === 'GET' || method === 'POST'))
    if (!allowMethod) {
      const allowHeader = isValidate ? 'GET, POST' : isUpdate ? 'POST' : 'GET'
      return NextResponse.json(
        { error: 'Method Not Allowed' },
        { status: 405, headers: { Allow: allowHeader } }
      )
    }

    if (method === 'GET') {
      const targetSearchParams = new URLSearchParams(
        (overrideSearchParams ?? request.nextUrl.searchParams).toString()
      )
      if (!targetSearchParams.get('version')) {
        targetSearchParams.set('version', version)
      }
      if (isSearch) {
        const cacheKey = buildSearchCacheKey(buildSearchCacheTarget(pathSegments, targetSearchParams))
        const cached = await readServerJsonCache<CachedSearchResponse>(cacheKey)
        if (cached) {
          return new NextResponse(cached.body, {
            status: cached.status,
            headers: cached.contentType
              ? { 'content-type': cached.contentType }
              : undefined,
          })
        }
      }
      const marketApi = await resolveMarketApiServiceConfig()
      const targetUrl = buildTargetUrl(
        marketApi.baseUrl || MARKET_API_URL_DEFAULT,
        request,
        pathSegments,
        targetSearchParams
      )
      const headers = buildForwardHeaders(request, marketApi.apiKey)
      const response = await fetch(targetUrl, {
        method,
        headers,
      })

      const responseHeaders = new Headers()
      response.headers.forEach((value, key) => {
        if (!hopByHopHeaders.has(key.toLowerCase())) {
          responseHeaders.set(key, value)
        }
      })

      responseHeaders.delete('content-encoding')
      responseHeaders.delete('content-length')

      const responseBody = await response.text()

      if (isSearch && response.ok) {
        await writeServerJsonCache(buildSearchCacheKey(buildSearchCacheTarget(pathSegments, targetSearchParams)), {
          body: responseBody,
          status: response.status,
          contentType: responseHeaders.get('content-type'),
        }, MARKET_SEARCH_CACHE_TTL_SECONDS)
      }

      return new NextResponse(responseBody, {
        status: response.status,
        headers: responseHeaders,
      })
    }

    const marketApi = await resolveMarketApiServiceConfig()
    const targetUrl = buildTargetUrl(
      marketApi.baseUrl || MARKET_API_URL_DEFAULT,
      request,
      pathSegments,
      overrideSearchParams
    )
    const headers = buildForwardHeaders(request, marketApi.apiKey)
    const forwardBody = JSON.stringify({ ...bodyPayload, version })
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: forwardBody,
    })

    const responseHeaders = new Headers()
    response.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) {
        responseHeaders.set(key, value)
      }
    })

    // Avoid content decoding mismatches when proxying compressed responses.
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    logger.error(`[${requestId}] Market proxy failed`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to proxy market request' }, { status: 502 })
  }
}
