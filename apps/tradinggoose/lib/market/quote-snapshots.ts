import type { ListingIdentity } from '@/lib/listing/identity'
import { executeProviderRequest } from '@/providers/market'
import type { MarketSeries } from '@/providers/market/types'

export type MarketQuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  error?: string
}

export const MARKET_QUOTE_SNAPSHOT_REQUEST_CAP = 200
export const MARKET_QUOTE_SNAPSHOT_PROVIDER_BATCH_SIZE = 10

export const createEmptyMarketQuoteSnapshot = (error?: string): MarketQuoteSnapshot => ({
  lastPrice: null,
  change: null,
  changePercent: null,
  previousClose: null,
  ...(error ? { error } : {}),
})

const normalizeSeries = (value: unknown): MarketSeries | null => {
  if (!value || typeof value !== 'object') return null
  const series = value as MarketSeries
  if (!Array.isArray(series.bars)) return null
  return series
}

const buildDailyRequest = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}) => {
  const response = await executeProviderRequest(provider, {
    kind: 'series',
    listing,
    interval: '1d',
    windows: [{ mode: 'bars', barCount: 2 }],
    auth,
    providerParams: {
      ...(providerParams ?? {}),
      marketSession: 'regular',
    },
  })

  return normalizeSeries(response)
}

const buildRegularLastRequest = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}) => {
  try {
    const response = await executeProviderRequest(provider, {
      kind: 'series',
      listing,
      interval: '1m',
      windows: [{ mode: 'bars', barCount: 1 }],
      auth,
      providerParams: {
        ...(providerParams ?? {}),
        allowEmpty: true,
        marketSession: 'regular',
      },
    })

    return normalizeSeries(response)
  } catch {
    return null
  }
}

export const buildMarketQuoteSnapshot = async ({
  provider,
  listing,
  auth,
  providerParams,
}: {
  provider: string
  listing: ListingIdentity
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
}): Promise<MarketQuoteSnapshot> => {
  try {
    const daily = await buildDailyRequest({ provider, listing, auth, providerParams })
    const dailyBars = daily?.bars ?? []
    const latestDaily = dailyBars[dailyBars.length - 1]
    const previousDaily = dailyBars[dailyBars.length - 2]
    const latestDailyClose = typeof latestDaily?.close === 'number' ? latestDaily.close : null
    const previousClose =
      typeof previousDaily?.close === 'number'
        ? previousDaily.close
        : typeof latestDaily?.close === 'number'
          ? latestDaily.close
          : null
    const regular = await buildRegularLastRequest({ provider, listing, auth, providerParams })
    const regularBar = regular?.bars?.[regular.bars.length - 1]
    const regularLastPrice = typeof regularBar?.close === 'number' ? regularBar.close : null
    const lastPrice = regularLastPrice ?? latestDailyClose
    const change =
      typeof lastPrice === 'number' && typeof previousClose === 'number'
        ? lastPrice - previousClose
        : null
    const changePercent =
      typeof change === 'number' && typeof previousClose === 'number' && previousClose !== 0
        ? (change / previousClose) * 100
        : null

    return {
      lastPrice,
      change,
      changePercent,
      previousClose,
    }
  } catch (error) {
    return createEmptyMarketQuoteSnapshot(
      error instanceof Error ? error.message : 'Failed to fetch snapshot'
    )
  }
}
