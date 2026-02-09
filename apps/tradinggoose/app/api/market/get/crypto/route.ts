import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { parseListParam } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cryptoIds = parseListParam(request.nextUrl.searchParams, 'crypto_id')
  if (!cryptoIds.length) {
    return NextResponse.json({ error: 'crypto_id is required.' }, { status: 400 })
  }
  if (cryptoIds.length > 200) {
    return NextResponse.json(
      { error: 'crypto_id supports up to 200 values.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams()
  for (const id of cryptoIds) {
    searchParams.append('crypto_id', id)
  }

  const version = request.nextUrl.searchParams.get('version')?.trim()
  if (version) {
    searchParams.set('version', version)
  }

  return proxyMarketRequest(request, ['get', 'crypto'], searchParams)
}
