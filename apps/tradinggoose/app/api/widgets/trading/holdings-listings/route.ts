import { NextResponse } from 'next/server'
import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import {
  createTradingWidgetRequestId,
  logBrokerRequestFailure,
  resolveTradingWidgetAccountContext,
  resolveTradingWidgetPreflight,
  tradingAccountIdentitySchema,
} from '@/app/api/widgets/trading/shared'
import { getTradingAccountSnapshot } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

export type TradingHoldingsListingsResponse = {
  listings: ListingIdentity[]
  invalidPositions: Array<{
    base?: string
    quote?: string
    assetClass?: string
  }>
}

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = createTradingWidgetRequestId('holdings-listings')
  const requestData = await resolveTradingWidgetPreflight({
    request,
    requestId,
    schema: tradingAccountIdentitySchema,
  })
  if (requestData instanceof Response) return requestData

  try {
    const context = await resolveTradingWidgetAccountContext({
      requestData,
      requestId,
    })
    if (context instanceof Response) return context

    const snapshot = await getTradingAccountSnapshot({
      providerId: context.providerId,
      environment: context.environment,
      accessToken: context.accessToken,
      accountId: context.accountId,
    })
    const listings: ListingIdentity[] = []
    const invalidPositions: TradingHoldingsListingsResponse['invalidPositions'] = []
    const seen = new Set<string>()

    for (const position of snapshot.positions) {
      const listing = toListingValueObject(position.symbol.listing)
      if (!listing) {
        invalidPositions.push({
          base: position.symbol.base || undefined,
          quote: position.symbol.quote || undefined,
          assetClass: position.symbol.assetClass || undefined,
        })
        continue
      }
      const key = getListingIdentityKey(listing)
      if (seen.has(key)) continue
      seen.add(key)
      listings.push(listing)
    }

    return NextResponse.json({ listings, invalidPositions }, { status: 200 })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) {
      logBrokerRequestFailure('holdings-listings', error)
      return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
    }

    logBrokerRequestFailure('holdings-listings', error)
    return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
  }
}
