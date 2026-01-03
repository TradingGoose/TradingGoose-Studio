import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax500, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CurrenciesSearchSchema = z.object({
  currency_id: optionalString,
  currency_name: optionalString,
  currency_code: optionalString,
  currency_query: optionalString,
  limit: limitMax500,
})

const CurrenciesSearchKeys = [
  'currency_id',
  'currency_name',
  'currency_code',
  'currency_query',
] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...CurrenciesSearchKeys, 'limit'])
  const parsed = CurrenciesSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = CurrenciesSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'currencies'])
}
