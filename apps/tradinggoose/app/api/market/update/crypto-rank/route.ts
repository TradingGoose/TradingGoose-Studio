import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CryptoRankSchema = z.object({
  crypto_id: optionalString,
  cryptoId: optionalString,
  code: optionalString,
  crypto_code: optionalString,
  chain_code: optionalString,
  chainCode: optionalString,
  address: optionalString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, [
    'crypto_id',
    'cryptoId',
    'code',
    'crypto_code',
    'chain_code',
    'chainCode',
    'address',
  ])
  const parsed = CryptoRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const cryptoId = parsed.data.crypto_id ?? parsed.data.cryptoId
  const code = parsed.data.crypto_code ?? parsed.data.code
  const chainCode = parsed.data.chain_code ?? parsed.data.chainCode
  const address = parsed.data.address

  if (!cryptoId && !(code && chainCode)) {
    return NextResponse.json(
      { error: 'crypto_id or code+chain_code is required.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams()
  if (cryptoId) {
    searchParams.set('crypto_id', cryptoId)
  } else {
    if (code) searchParams.set('crypto_code', code)
    if (chainCode) searchParams.set('chain_code', chainCode)
    if (address) searchParams.set('address', address)
  }
  return proxyMarketRequest(request, ['update', 'crypto-rank'], searchParams)
}
