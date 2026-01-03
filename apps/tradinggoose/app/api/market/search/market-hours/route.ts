import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax200, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const MarketHoursSearchSchema = z.object({
  listing_id: optionalString,
  listing_name: optionalString,
  listing_base: optionalString,
  mic_id: optionalString,
  mic_name: optionalString,
  mic_code: optionalString,
  city_id: optionalString,
  city_name: optionalString,
  country_id: optionalString,
  country_name: optionalString,
  country_code: optionalString,
  asset_class: optionalString,
  limit: limitMax200,
})

const MarketHoursSearchKeys = [
  'listing_id',
  'listing_name',
  'listing_base',
  'mic_id',
  'mic_name',
  'mic_code',
  'city_id',
  'city_name',
  'country_id',
  'country_name',
  'country_code',
  'asset_class',
] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...MarketHoursSearchKeys, 'limit'])
  const parsed = MarketHoursSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = MarketHoursSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'market-hours'])
}
