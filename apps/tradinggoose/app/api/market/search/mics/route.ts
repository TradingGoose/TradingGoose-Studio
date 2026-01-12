import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax500, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const MicsSearchSchema = z.object({
  mic_id: optionalString,
  mic_name: optionalString,
  mic_code: optionalString,
  country_id: optionalString,
  limit: limitMax500,
})

const MicsSearchKeys = ['mic_id', 'mic_name', 'mic_code', 'country_id'] as const

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, [...MicsSearchKeys, 'limit'])
  const parsed = MicsSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = MicsSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'mics'])
}
