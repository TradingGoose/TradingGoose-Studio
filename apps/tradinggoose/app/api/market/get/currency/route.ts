import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { parseListParam } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const currencyIds = parseListParam(request.nextUrl.searchParams, 'currency_id')
  if (!currencyIds.length) {
    return NextResponse.json({ error: 'currency_id is required.' }, { status: 400 })
  }
  if (currencyIds.length > 200) {
    return NextResponse.json(
      { error: 'currency_id supports up to 200 values.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  searchParams.delete('currencyId')

  return proxyMarketRequest(request, ['get', 'currency'], searchParams)
}
