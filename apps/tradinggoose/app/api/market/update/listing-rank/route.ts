import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { proxyMarketRequest } from '@/app/api/market/proxy'
import { buildQueryParams, optionalString } from '@/app/api/market/search/validation'

export const dynamic = 'force-dynamic'

const ListingRankSchema = z.object({
  listing_id: optionalString,
})

export async function POST(request: NextRequest) {
  const params = buildQueryParams(request, ['listing_id'])
  const parsed = ListingRankSchema.safeParse(params)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.errors },
      { status: 400 }
    )
  }

  const listingId = parsed.data.listing_id
  if (!listingId) {
    return NextResponse.json({ error: 'listing_id is required.' }, { status: 400 })
  }

  const searchParams = new URLSearchParams({ listing_id: listingId })
  return proxyMarketRequest(request, ['update', 'listing-rank'], searchParams)
}
