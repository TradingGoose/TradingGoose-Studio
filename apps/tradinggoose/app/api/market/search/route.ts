import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const SearchSchema = z.object({
  search_query: optionalString,
  filters: optionalString,
  listing_quote_name: optionalString,
  listing_quote_code: optionalString,
  crypto_quote_name: optionalString,
  crypto_quote_code: optionalString,
  currency_quote_name: optionalString,
  currency_quote_code: optionalString,
})

const SearchKeys = [
  'search_query',
  'filters',
  'listing_quote_name',
  'listing_quote_code',
  'crypto_quote_name',
  'crypto_quote_code',
  'currency_quote_name',
  'currency_quote_code',
] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...SearchKeys])
  const parsed = SearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = SearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search'])
}
