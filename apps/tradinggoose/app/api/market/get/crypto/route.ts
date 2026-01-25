import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const GetCryptoSchema = z.object({
  crypto_id: optionalString,
  cryptoId: optionalString,
})

export async function GET(request: NextRequest) {
  const params = buildQueryParams(request, ['crypto_id', 'cryptoId'])
  const parsed = GetCryptoSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const cryptoId = parsed.data.crypto_id ?? parsed.data.cryptoId
  if (!cryptoId) {
    return NextResponse.json({ error: 'crypto_id is required.' }, { status: 400 })
  }

  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  searchParams.set('crypto_id', cryptoId)
  searchParams.delete('cryptoId')

  return proxyMarketRequest(request, ['get', 'crypto'], searchParams)
}
