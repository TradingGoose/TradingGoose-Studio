import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, nonEmptyString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CurrencyRankSchema = z.object({
  currency_id: nonEmptyString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, ['currency_id'])
  const parsed = CurrencyRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams({ currency_id: parsed.data.currency_id })
  return proxyMarketRequest(request, ['update', 'currency-rank'], searchParams)
}
