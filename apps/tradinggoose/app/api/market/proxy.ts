import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { requestTradingGooseMarket } from '@/lib/market/request-gate'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketProxyAPI')

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

const buildMarketEndpoint = (pathSegments?: string[], overrideSearchParams?: URLSearchParams) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const search = overrideSearchParams?.toString()
  return `/api${path}${search ? `?${search}` : ''}`
}

const buildMarketEndpointFromRequest = (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const endpoint = new URL(`/api${path}`, 'https://local.tradinggoose')
  if (overrideSearchParams) {
    const search = overrideSearchParams.toString()
    endpoint.search = search ? `?${search}` : ''
  } else {
    endpoint.search = request.nextUrl.search ?? ''
  }
  return `${endpoint.pathname}${endpoint.search}`
}

const buildForwardHeaders = (request: NextRequest) => {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  if (!headers.get('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return headers
}

const buildProxyResponse = async (response: Response) => {
  const responseHeaders = new Headers()
  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })

  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  })
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

    const headers = buildForwardHeaders(request)

    if (method === 'GET') {
      const targetSearchParams = new URLSearchParams(
        (overrideSearchParams ?? request.nextUrl.searchParams).toString()
      )
      if (!targetSearchParams.get('version')) {
        targetSearchParams.set('version', version)
      }
      const response = await requestTradingGooseMarket(
        buildMarketEndpoint(pathSegments, targetSearchParams),
        {
          method,
          headers,
        }
      )
      return buildProxyResponse(response)
    }

    const forwardBody = JSON.stringify({ ...bodyPayload, version })
    const response = await requestTradingGooseMarket(
      buildMarketEndpointFromRequest(request, pathSegments, overrideSearchParams),
      {
        method,
        headers,
        body: forwardBody,
      }
    )
    return buildProxyResponse(response)
  } catch (error) {
    logger.error(`[${requestId}] Market proxy failed`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to proxy market request' }, { status: 502 })
  }
}
