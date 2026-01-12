import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MarketProxyAPI')
const MARKET_API_URL = env.MARKET_API_URL || MARKET_API_URL_DEFAULT
const VERSION_HEADER = 'x-api-version'
const VERSION_QUERY_KEYS = ['version', 'v'] as const

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

const getQueryVersion = (params?: URLSearchParams | null) => {
  if (!params) return null
  for (const key of VERSION_QUERY_KEYS) {
    const value = params.get(key)
    if (value?.trim()) return value.trim()
  }
  return null
}

const normalizeVersion = (raw: string | null) => {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^v?(\d+)(?:\.(\d+))?$/i)
  if (!match) return null
  const major = match[1]
  const minor = match[2] ?? '0'
  return `${major}.${minor}`
}

const resolveVersion = (request: NextRequest, overrideSearchParams?: URLSearchParams) => {
  const overrideVersion = getQueryVersion(overrideSearchParams)
  const queryVersion = getQueryVersion(request.nextUrl.searchParams)
  const headerVersion = request.headers.get(VERSION_HEADER)
  const raw = overrideVersion ?? headerVersion ?? queryVersion ?? MARKET_API_VERSION
  return normalizeVersion(raw)
}

const buildTargetUrl = (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const path = pathSegments?.length ? `/${pathSegments.join('/')}` : ''
  const target = new URL(`/api${path}`, MARKET_API_URL)
  if (overrideSearchParams) {
    const search = overrideSearchParams.toString()
    target.search = search ? `?${search}` : ''
  } else {
    target.search = request.nextUrl.search ?? ''
  }
  return target.toString()
}

const buildForwardHeaders = (request: NextRequest, version: string) => {
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
  headers.set(VERSION_HEADER, version)
  return headers
}

export const proxyMarketRequest = async (
  request: NextRequest,
  pathSegments?: string[],
  overrideSearchParams?: URLSearchParams
) => {
  const requestId = generateRequestId()
  const version = resolveVersion(request, overrideSearchParams)
  if (!version) {
    return NextResponse.json({ error: 'Invalid API version' }, { status: 400 })
  }
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
    const headers = buildForwardHeaders(request, version)

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
