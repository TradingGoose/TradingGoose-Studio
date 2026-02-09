import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax200, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const ListingsSearchSchema = z.object({
  country_id: optionalString,
  asset_class: optionalString,
  listing_quote_id: optionalString,
  listing_quote_name: optionalString,
  listing_quote_code: optionalString,
  country_name: optionalString,
  country_code: optionalString,
  search_query: optionalString,
  base_query: optionalString,
  quote_query: optionalString,
  region: optionalString,
  listing_name: optionalString,
  listing_base: optionalString,
  listing_quote: optionalString,
  market: optionalString,
  market_name: optionalString,
  market_code: optionalString,
  market_id: optionalString,
  limit: limitMax200,
})

const ListingsSearchKeys = [
  'country_id',
  'asset_class',
  'listing_quote_id',
  'listing_quote_name',
  'listing_quote_code',
  'country_name',
  'country_code',
  'search_query',
  'base_query',
  'quote_query',
  'region',
  'listing_name',
  'listing_base',
  'listing_quote',
  'market',
  'market_name',
  'market_code',
  'market_id',
] as const

export async function GET(request: NextRequest) {
  const listingId = request.nextUrl.searchParams.get('listing_id')?.trim()
  if (listingId) {
    return NextResponse.json(
      {
        error: 'listing_id is not supported on /search/listings. Use /get/listing instead.',
      },
      { status: 400 }
    )
  }

  const params = buildQueryParams(request, [...ListingsSearchKeys, 'limit'])
  const parsed = ListingsSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = ListingsSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'listings'])
}
