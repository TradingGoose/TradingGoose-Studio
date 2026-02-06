import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, limitMax200, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const CryptoSearchSchema = z.object({
  crypto_base_id: optionalString,
  crypto_quote_id: optionalString,
  crypto_base_code: optionalString,
  crypto_quote_code: optionalString,
  crypto_base_name: optionalString,
  crypto_quote_name: optionalString,
  base_query: optionalString,
  quote_query: optionalString,
  search_query: optionalString,
  chain: optionalString,
  chain_id: optionalString,
  chain_code: optionalString,
  chain_name: optionalString,
  crypto_quote_type: optionalString,
  quote_type: optionalString,
  limit: limitMax200,
})

const CryptoSearchKeys = [
  'crypto_base_id',
  'crypto_quote_id',
  'crypto_base_code',
  'crypto_quote_code',
  'crypto_base_name',
  'crypto_quote_name',
  'base_query',
  'quote_query',
  'search_query',
  'chain',
  'chain_id',
  'chain_code',
  'chain_name',
  'crypto_quote_type',
  'quote_type',
] as const

export async function GET(request: NextRequest) {
  const cryptoId = request.nextUrl.searchParams.get('crypto_id')?.trim()
  if (cryptoId) {
    return NextResponse.json(
      { error: 'crypto_id is not supported on /search/cryptos. Use /get/crypto instead.' },
      { status: 400 }
    )
  }

  const params = buildQueryParams(request, [...CryptoSearchKeys, 'limit'])
  const parsed = CryptoSearchSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const hasSearch = CryptoSearchKeys.some((key) => parsed.data[key] !== undefined)
  if (!hasSearch) {
    return NextResponse.json(
      { error: 'At least one search parameter is required.' },
      { status: 400 }
    )
  }

  return proxyMarketRequest(request, ['search', 'cryptos'])
}
