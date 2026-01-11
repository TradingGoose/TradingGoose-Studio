import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, nonEmptyString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CryptoRankSchema = z.object({
  crypto_id: nonEmptyString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, ['crypto_id'])
  const parsed = CryptoRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams({ crypto_id: parsed.data.crypto_id })
  return proxyMarketRequest(request, ['update', 'crypto-rank'], searchParams)
}
