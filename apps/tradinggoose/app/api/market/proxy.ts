import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT } from '@/lib/market/client/constants'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketProxyAPI')
const MARKET_API_URL = env.MARKET_API_URL || MARKET_API_URL_DEFAULT

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

const buildTargetUrl = (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const target = new URL(`/api/v1${path}`, MARKET_API_URL)
  if (overrideSearchParams) {
    const search = overrideSearchParams.toString()
    target.search = search ? `?${search}` : ''
  } else {
    target.search = request.nextUrl.search ?? ''
  }
  return target.toString()
}

const buildForwardHeaders = (request: NextRequest) => {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  const apiKey = env.MARKET_API_KEY
  if (apiKey) {
    headers.set('x-api-key', apiKey)
  }
  return headers
}

export const proxyMarketRequest = async (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const requestId = generateRequestId()
  const targetUrl = buildTargetUrl(request, pathSegments, overrideSearchParams)

  try {
    const method = request.method.toUpperCase()
    const scope = pathSegments?.[0]
    if (!pathSegments || (scope !== 'search' && scope !== 'update')) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }
    const allowMethod =
      (scope === 'search' && method === 'GET') || (scope === 'update' && method === 'POST')
    if (!allowMethod) {
      return NextResponse.json(
        { error: 'Method Not Allowed' },
        { status: 405, headers: { Allow: scope === 'search' ? 'GET' : 'POST' } }
      )
    }
    const headers = buildForwardHeaders(request)

    logger.info(`[${requestId}] Proxying market request`, {
      method,
      targetUrl,
    })

    const response = await fetch(targetUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'POST' ? undefined : request.body,
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
