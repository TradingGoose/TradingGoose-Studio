import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax200, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const EquitySearchSchema = z.object({
  equity_id: optionalString,
  search_query: optionalString,
  base_query: optionalString,
  quote_query: optionalString,
  region: optionalString,
  asset_class: optionalString,
  equity_quote_id: optionalString,
  equity_quote_name: optionalString,
  equity_quote_code: optionalString,
  listing_name: optionalString,
  listing_base: optionalString,
  listing_quote: optionalString,
  mic_name: optionalString,
  mic_code: optionalString,
  mic_id: optionalString,
  country_id: optionalString,
  country_name: optionalString,
  country_code: optionalString,
  limit: limitMax200,
})

const EquitySearchKeys = [
  'equity_id',
  'search_query',
  'base_query',
  'quote_query',
  'region',
  'asset_class',
  'equity_quote_id',
  'equity_quote_name',
  'equity_quote_code',
  'listing_name',
  'listing_base',
  'listing_quote',
  'mic_name',
  'mic_code',
  'mic_id',
  'country_id',
  'country_name',
  'country_code',
] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...EquitySearchKeys, 'limit'])
  const parsed = EquitySearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = EquitySearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'equity'])
}
