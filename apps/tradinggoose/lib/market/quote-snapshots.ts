import type { ListingIdentity } from '@/lib/listing/identity'
import {
  createMarketQuoteSnapshot,
  getMarketQuoteDate,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { executeProviderRequest } from '@/providers/market'
import { resolveMarketSessionsForRange } from '@/providers/market/market-hours'
import { toZonedIsoTimestamp } from '@/providers/market/market-hours/date-utils'
import type { MarketProviderRequestContext, MarketSeries } from '@/providers/market/types'
import { resolveListingContext } from '@/providers/market/utils'

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
  const dailyOnly =
    listing.listing_type === 'default' &&
    (await resolveListingContext(listing)).assetClass === 'mutualfund'
  const requestStartedAt = Date.now()
  const fetchSeries = async (interval: '1d' | '1m', days: number) =>
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
  let intradayError: string | undefined
  const [daily, intraday] = await Promise.all([
    fetchSeries('1d', 14),
    dailyOnly
      ? undefined
      : fetchSeries('1m', listing.listing_type === 'currency' ? 7 : 1).catch((error) => {
          intradayError =
            error instanceof Error ? error.message : 'marketQuotes.intradayUnavailable'
          return undefined
        }),
  ])
  const priceSeries = intraday?.bars.length ? intraday : daily
  const timezone = listing.listing_type === 'default' ? priceSeries.timezone : 'UTC'
  if (!timezone) throw new Error('marketQuotes.missingTimezone')
  let marketSessions = intraday?.marketSessions ?? []
  if (
    listing.listing_type === 'default' &&
    !dailyOnly &&
    !marketSessions.some(({ type }) => type === 'market')
  ) {
    const latestTime = Date.parse(priceSeries.bars.at(-1)?.timeStamp ?? '')
    marketSessions =
      (await resolveMarketSessionsForRange(
        listing.listing_id,
        listing.listing_type,
        latestTime - 86_400_000,
        Math.max(requestStartedAt, latestTime) + 1
      )) ?? []
  }
  const sessions = marketSessions.filter(({ type }) => type === 'market')
  const minuteBar = intraday?.bars
    .filter(
      ({ timeStamp }) =>
        !sessions.length ||
        sessions.some(
          ({ start, end }) =>
            Date.parse(timeStamp) >= Date.parse(start) && Date.parse(timeStamp) < Date.parse(end)
        )
    )
    .at(-1)
  const today = getMarketQuoteDate(new Date(requestStartedAt).toISOString(), timezone)
  const minuteDate = minuteBar && getMarketQuoteDate(minuteBar.timeStamp, timezone)
  const minuteSession = sessions.find(({ date }) => date === minuteDate)
  const dailyPrice =
    !minuteBar ||
    (listing.listing_type === 'default' &&
      (minuteSession ? Date.parse(minuteSession.end) <= requestStartedAt : minuteDate! < today))
  const priceBar = dailyPrice ? daily.bars.at(-1) : minuteBar
  if (!priceBar) throw new Error(intradayError ?? 'marketQuotes.noRegularSessionPrice')
  const priceDate = getMarketQuoteDate(priceBar.timeStamp, timezone)
  const dailyBars = [...daily.bars].reverse()
  const previousDaily = dailyBars.find(
    (bar) => getMarketQuoteDate(bar.timeStamp, timezone) < priceDate
  )
  const sessionDaily = dailyBars.find(
    (bar) => getMarketQuoteDate(bar.timeStamp, timezone) === priceDate
  )
  const session = sessions.find(({ date }) => date === priceDate)
  const completed =
    dailyOnly ||
    (dailyPrice && (session ? Date.parse(session.end) <= requestStartedAt : priceDate < today))
  if (!dailyOnly && !minuteBar && !(listing.listing_type === 'default' && completed))
    intradayError ??= 'marketQuotes.noIntradayPrice'
  const priceTime = Date.parse(priceBar.timeStamp)
  return createMarketQuoteSnapshot({
    lastPrice: priceBar.close,
    previousClose: previousDaily?.close,
    lastPriceTime: priceBar.timeStamp,
    lastPriceEndTime: completed
      ? (session?.end ??
        toZonedIsoTimestamp(
          new Date(Date.parse(priceDate) + 86_400_000).toISOString().slice(0, 10),
          new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
        ))
      : dailyPrice
        ? undefined
        : new Date(
            Math.max(priceTime, Math.min(requestStartedAt, priceTime + 60_000))
          ).toISOString(),
    timezone,
    volume: sessionDaily?.volume,
    ...(session ? { regularSession: { start: session.start, end: session.end } } : {}),
    error: intradayError ?? (!previousDaily ? 'marketQuotes.previousCloseUnavailable' : undefined),
  })
}
