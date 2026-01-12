import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, nonEmptyString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const EquityRankSchema = z.object({
  equity_id: nonEmptyString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, ['equity_id'])
  const parsed = EquityRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  // Market API still expects equity_id for equities.
  const searchParams = new URLSearchParams({ equity_id: parsed.data.equity_id })
  return proxyMarketRequest(request, ['update', 'equity-rank'], searchParams)
}
