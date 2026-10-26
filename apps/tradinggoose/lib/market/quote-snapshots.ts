import type { ListingIdentity } from '@/lib/listing/identity'
import {
  createMarketQuoteSnapshot,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { executeProviderRequest } from '@/providers/market'
import type {
  MarketBar,
  MarketProviderRequestContext,
  MarketSeries,
} from '@/providers/market/types'

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
            normalizationMode: 'raw',
            auth,
            providerParams: { ...providerParams, marketSession: 'regular' },
          },
          context
        )) as MarketSeries
    )
  )
  const timeZone = listing.listing_type === 'default' ? regular.timezone : 'UTC'
  if (!timeZone) throw new Error('Market series timezone is required')
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const tradingDate = (bar: MarketBar) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(bar.timeStamp)).map(({ type, value }) => [type, value])
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }
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
  const priceDate = tradingDate(priceBar)
  const dailyBars = [...daily.bars].reverse()
  const previousDaily = dailyBars.find((bar) => tradingDate(bar) < priceDate)
  const volumeBar = dailyBars.find((bar) => tradingDate(bar) === priceDate)
  const session = sessions.find(({ date }) => date === priceDate)
  const regularSession =
    listing.listing_type === 'crypto'
      ? {
          start: `${priceDate}T00:00:00.000Z`,
          end: new Date(Date.parse(`${priceDate}T00:00:00Z`) + 86_400_000).toISOString(),
        }
      : session
        ? { start: session.start, end: session.end }
        : undefined
  return createMarketQuoteSnapshot({
    lastPrice: priceBar.close,
    previousClose: previousDaily?.close,
    lastPriceTime: priceBar.timeStamp,
    volume: volumeBar?.volume,
    ...(regularSession ? { regularSession } : {}),
    ...(!previousDaily ? { error: 'Previous regular-session close is unavailable' } : {}),
  })
}
