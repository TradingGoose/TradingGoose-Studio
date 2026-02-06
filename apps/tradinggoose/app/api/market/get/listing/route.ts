import { type NextRequest, NextResponse } from 'next/server'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { parseListParam } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const listingIds = parseListParam(request.nextUrl.searchParams, 'listing_id')
  if (!listingIds.length) {
    return NextResponse.json({ error: 'listing_id is required.' }, { status: 400 })
  }
  if (listingIds.length > 200) {
    return NextResponse.json(
      { error: 'listing_id supports up to 200 values.' },
      { status: 400 }
    )
  }

  const searchParams = new URLSearchParams()
  for (const id of listingIds) {
    searchParams.append('listing_id', id)
  }

  const version = request.nextUrl.searchParams.get('version')?.trim()
  if (version) {
    searchParams.set('version', version)
  }

  return proxyMarketRequest(request, ['get', 'listing'], searchParams)
}
