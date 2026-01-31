import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { parseListParam } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const equityIds = parseListParam(request.nextUrl.searchParams, 'equity_id')
  if (!equityIds.length) {
    return NextResponse.json({ error: 'equity_id is required.' }, { status: 400 })
  }
  if (equityIds.length > 200) {
    return NextResponse.json(
      { error: 'equity_id supports up to 200 values.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  searchParams.delete('equityId')

  return proxyMarketRequest(request, ['get', 'equity'], searchParams)
}
