import type { ListingIdentity } from '@/lib/listing/identity'
import {
  createMarketQuoteSnapshot,
  getMarketQuoteDate,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { executeProviderRequest } from '@/providers/market'
import type { MarketProviderRequestContext, MarketSeries } from '@/providers/market/types'

export const buildMarketQuoteSnapshot = async ({
  provider,
  listing,
  auth,
  providerParams,
  context,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
  context?: MarketProviderRequestContext
}): Promise<MarketQuoteSnapshot> => {
  const requestStartedAt = Date.now()
  const [daily, regular] = await Promise.all(
    (
      [
        ['1d', 14],
        ['1m', 1],
      ] as const
    ).map(
      async ([interval, days]) =>
        (await executeProviderRequest(
          provider,
          {
            kind: 'series',
            listing,
            interval,
            windows: [{ mode: 'range', range: { value: days, unit: 'day' } }],
            normalizationMode:
              interval === '1d' && listing.listing_type === 'default' ? 'split_adjusted' : 'raw',
            auth,
            providerParams: { ...providerParams, marketSession: 'regular' },
          },
          context
        )) as MarketSeries
    )
  )
  const timezone = listing.listing_type === 'default' ? regular.timezone : 'UTC'
  if (!timezone) throw new Error('Market series timezone is required')
  const sessions = regular.marketSessions?.filter(({ type }) => type === 'market') ?? []
  const priceBar = regular.bars
    .filter(
      ({ timeStamp }) =>
        !sessions.length ||
        sessions.some(
          ({ start, end }) =>
            Date.parse(timeStamp) >= Date.parse(start) && Date.parse(timeStamp) < Date.parse(end)
        )
    )
    .at(-1)
  if (!priceBar) throw new Error('No regular-session price available')
  const priceDate = getMarketQuoteDate(priceBar.timeStamp, timezone)
  const dailyBars = [...daily.bars].reverse()
  const previousDaily = dailyBars.find(
    (bar) => getMarketQuoteDate(bar.timeStamp, timezone) < priceDate
  )
  const volumeBar = dailyBars.find(
    (bar) => getMarketQuoteDate(bar.timeStamp, timezone) === priceDate
  )
  const session = sessions.find(({ date }) => date === priceDate)
  const priceTime = Date.parse(priceBar.timeStamp)
  return createMarketQuoteSnapshot({
    lastPrice: priceBar.close,
    previousClose: previousDaily?.close,
    lastPriceTime: priceBar.timeStamp,
    lastPriceEndTime: new Date(
      Math.max(priceTime, Math.min(requestStartedAt, priceTime + 60_000))
    ).toISOString(),
    timezone,
    volume: volumeBar?.volume,
    ...(session ? { regularSession: { start: session.start, end: session.end } } : {}),
    ...(!previousDaily ? { error: 'Previous regular-session close is unavailable' } : {}),
  })
}
