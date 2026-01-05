import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax200, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const ListingsSearchSchema = z.object({
  listing_id: optionalString,
  country_id: optionalString,
  asset_class: optionalString,
  currency_id: optionalString,
  currency_name: optionalString,
  currency_code: optionalString,
  country_name: optionalString,
  country_code: optionalString,
  listing_name: optionalString,
  listing_base: optionalString,
  listing_search_query: optionalString,
  mic_name: optionalString,
  mic_code: optionalString,
  mic_id: optionalString,
  limit: limitMax200,
})

const ListingsSearchKeys = [
  'listing_id',
  'country_id',
  'asset_class',
  'currency_id',
  'currency_name',
  'currency_code',
  'country_name',
  'country_code',
  'listing_name',
  'listing_base',
  'listing_search_query',
  'mic_name',
  'mic_code',
  'mic_id',
] as const

export async function GET(request: NextRequest) {
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
