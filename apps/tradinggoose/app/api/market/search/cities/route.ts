import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax500, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CitiesSearchSchema = z.object({
  city_id: optionalString,
  city_name: optionalString,
  country_id: optionalString,
  limit: limitMax500,
})

const CitiesSearchKeys = ['city_id', 'city_name', 'country_id'] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...CitiesSearchKeys, 'limit'])
  const parsed = CitiesSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'cities'])
}
