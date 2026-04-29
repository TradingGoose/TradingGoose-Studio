import { NextResponse } from 'next/server'
import { getListingIdentityKey } from '@/lib/listing/identity'
import {
  createTradingProviderRequestId,
  logBrokerRequestFailure,
  resolveTradingProviderAccountContext,
  resolveTradingProviderPreflight,
  tradingAccountIdentitySchema,
} from '@/app/api/providers/trading/shared'
import { resolveTradingPositionListingIdentity } from '@/providers/trading/listing-resolution'
import { getTradingAccountSnapshot } from '@/providers/trading/portfolio'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import type { UnifiedTradingPositionListings } from '@/providers/trading/types'

export const dynamic = 'force-dynamic'

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export async function POST(request: Request) {
  const requestId = createTradingProviderRequestId('holdings-listings')
  const requestData = await resolveTradingProviderPreflight({
    request,
    requestId,
    schema: tradingAccountIdentitySchema,
  })
  if (requestData instanceof Response) return requestData

  try {
    const context = await resolveTradingProviderAccountContext({
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

    const positionListingsByKey = new Map<
      string,
      UnifiedTradingPositionListings['positionListings'][number]
    >()

    for (const position of snapshot.positions) {
      const listing = await resolveTradingPositionListingIdentity(position.symbol, request.signal)
      if (!listing) {
        continue
      }

      const key = getListingIdentityKey(listing)
      const multiplier = isFiniteNumber(position.multiplier) ? position.multiplier : 1
      const conversionRate = isFiniteNumber(position.conversionRate) ? position.conversionRate : 1
      const quantity = isFiniteNumber(position.quantity) ? position.quantity : 0
      const signedQuantity = quantity * multiplier * conversionRate
      const grossQuantity = Math.abs(signedQuantity)
      const current = positionListingsByKey.get(key)

      if (current) {
        current.grossQuantity += grossQuantity
        current.signedQuantity += signedQuantity
        continue
      }

      positionListingsByKey.set(key, {
        listing,
        grossQuantity,
        signedQuantity,
      })
    }

    const positionListings: UnifiedTradingPositionListings = {
      positionListings: Array.from(positionListingsByKey.values()),
    }

    return NextResponse.json(positionListings, { status: 200 })
  } catch (error) {
    if (error instanceof TradingBrokerRequestError) {
      logBrokerRequestFailure('holdings-listings', error)
      return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
    }

    logBrokerRequestFailure('holdings-listings', error)
    return NextResponse.json({ error: 'Broker request failed' }, { status: 502 })
  }
}
