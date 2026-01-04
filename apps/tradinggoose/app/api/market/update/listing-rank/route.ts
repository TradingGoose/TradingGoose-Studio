import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { MARKET_API_URL_DEFAULT } from '@/lib/market/client/constants'
import { generateRequestId } from '@/lib/utils'
import { buildQueryParams, nonEmptyString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('MarketUpdateListingRank')
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

const ListingRankSchema = z.object({
  listing_id: nonEmptyString,
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const params = buildQueryParams(request, ['listing_id'])
  const parsed = ListingRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const targetUrl = new URL('/api/update/listing-rank', MARKET_API_URL)
  targetUrl.searchParams.set('listing_id', parsed.data.listing_id)

  try {
    const headers = new Headers()
    request.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) {
        headers.set(key, value)
      }
    })
    if (env.MARKET_API_KEY) {
      headers.set('x-api-key', env.MARKET_API_KEY)
    }

    logger.info(`[${requestId}] Proxying market update`, {
      targetUrl: targetUrl.toString(),
    })

    const response = await fetch(targetUrl.toString(), {
      method: 'POST',
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
    logger.error(`[${requestId}] Market update failed`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to update listing rank' }, { status: 502 })
  }
}
