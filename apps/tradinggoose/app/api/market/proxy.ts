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

const buildTargetUrl = (request: NextRequest, pathSegments?: string[]) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const target = new URL(`/api${path}`, MARKET_API_URL)
  target.search = request.nextUrl.search ?? ''
  return target.toString()
}

const buildForwardHeaders = (request: NextRequest) => {
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  if (env.MARKET_API_KEY) {
    headers.set('x-api-key', env.MARKET_API_KEY)
  }
  return headers
}

export const proxyMarketRequest = async (request: NextRequest, pathSegments?: string[]) => {
  const requestId = generateRequestId()
  const targetUrl = buildTargetUrl(request, pathSegments)

  try {
    const method = request.method.toUpperCase()
    if (!pathSegments || pathSegments[0] !== 'search') {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }
    if (method !== 'GET') {
      return NextResponse.json(
        { error: 'Method Not Allowed' },
        { status: 405, headers: { Allow: 'GET' } }
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
    })

    const responseHeaders = new Headers()
    response.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) {
        responseHeaders.set(key, value)
      }
    })

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
