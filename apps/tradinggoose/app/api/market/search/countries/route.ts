import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax500, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CountriesSearchSchema = z.object({
  country_id: optionalString,
  country_name: optionalString,
  country_code: optionalString,
  limit: limitMax500,
})

const CountriesSearchKeys = ['country_id', 'country_name', 'country_code'] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...CountriesSearchKeys, 'limit'])
  const parsed = CountriesSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = CountriesSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'countries'])
}
