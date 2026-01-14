import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const ListingsSearchSchema = z.object({
  search_query: optionalString,
  filters: optionalString,
  equity_quote_name: optionalString,
  equity_quote_code: optionalString,
  crypto_quote_name: optionalString,
  crypto_quote_code: optionalString,
  currency_quote_name: optionalString,
  currency_quote_code: optionalString,
})

const ListingsSearchKeys = [
  'search_query',
  'filters',
  'equity_quote_name',
  'equity_quote_code',
  'crypto_quote_name',
  'crypto_quote_code',
  'currency_quote_name',
  'currency_quote_code',
] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...ListingsSearchKeys])
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
