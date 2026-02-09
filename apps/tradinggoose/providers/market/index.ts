import { createLogger } from '@/lib/logs/console/logger'
import { MarketProviderError } from '@/providers/market/errors'
import { alphaVantageProvider } from '@/providers/market/alpha-vantage'
import { alpacaProvider } from '@/providers/market/alpaca'
import { finnhubProvider } from '@/providers/market/finnhub'
import {
  clampToMarketSession,
  filterSeriesBySessions,
  filterSessionsToRange,
  resolveLatestSessionEndMs,
  resolveListingId,
  resolveMarketSessionsForRange,
  resolveSeriesBoundsMs,
} from '@/providers/market/market-hours'
import type { MarketProviderRequest, MarketProviderResponse } from '@/providers/market/providers'
import { applySeriesWindow, planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketSeries, MarketSeriesRequest, MarketSessionWindow } from '@/providers/market/types'
import { YahooFinanceProvider } from '@/providers/market/yahoo-finance'

const logger = createLogger('MarketProviders')

const providers = {
  'alpha-vantage': alphaVantageProvider,
  alpaca: alpacaProvider,
  finnhub: finnhubProvider,
  'yahoo-finance': YahooFinanceProvider,
}

export function getProvider(providerId: string) {
  const id = providerId.split('/')[0] as keyof typeof providers
  return providers[id]
}

export async function executeProviderRequest(
  providerId: string,
  request: MarketProviderRequest
): Promise<MarketProviderResponse> {
  const provider = getProvider(providerId)
  if (!provider) {
    throw new MarketProviderError({
      code: 'UNSUPPORTED PROVIDER',
      message: `Market provider not found: ${providerId}`,
      provider: providerId,
      status: 404,
    })
  }

  const availability = provider.config.availability
  const supportsKind = availability[request.kind] ?? false

  if (!supportsKind) {
    throw new MarketProviderError({
      code: 'INVALID REQUEST',
      message: `Provider ${providerId} does not support ${request.kind}`,
      provider: providerId,
      status: 400,
    })
  }

  switch (request.kind) {
    case 'series': {
      if (!provider.fetchMarketSeries) {
        throw new MarketProviderError({
          code: 'INVALID REQUEST',
          message: `Provider ${providerId} does not support market series`,
          provider: providerId,
          status: 400,
        })
      }
      const normalizedProviderParams: Record<string, unknown> = {
        ...(request.providerParams ?? {}),
      }
      const marketSessionValue = String(normalizedProviderParams.marketSession ?? '').toLowerCase()
      if (marketSessionValue !== 'regular' && marketSessionValue !== 'extended') {
        normalizedProviderParams.marketSession = 'regular'
      } else {
        normalizedProviderParams.marketSession = marketSessionValue
      }
      const normalizedRequest: MarketSeriesRequest = {
        ...request,
        providerParams: normalizedProviderParams,
      }
      const {
        request: plannedRequest,
        window,
        mode: plannedMode,
        fallback: planFallback,
        reason: planReason,
      } = planMarketSeriesRequest(providerId, normalizedRequest)
      const hasWindows = Array.isArray(normalizedRequest.windows) && normalizedRequest.windows.length > 0
      if (hasWindows && !plannedMode) {
        throw new MarketProviderError({
          code: 'INVALID REQUEST',
          message: 'No supported window mode available for market series request',
          provider: providerId,
          status: 400,
        })
      }
      if (planFallback) {
        logger.warn('Market series window mode fallback applied', {
          providerId,
          requested: normalizedRequest.windows?.[0]?.mode,
          resolved: plannedMode,
          reason: planReason,
        })
      }
      const listingId = resolveListingId(normalizedRequest.listing)
      let sessionAdjustedRequest = plannedRequest
      const sessionPref = normalizedRequest.providerParams?.marketSession
      if (
        listingId &&
        window?.mode === 'range' &&
        normalizedRequest.listing?.listing_type === 'default' &&
        (sessionPref === 'regular' || sessionPref === 'extended')
      ) {
        const latestEndMs = await resolveLatestSessionEndMs(
          listingId,
          normalizedRequest.listing.listing_type,
          sessionPref
        )
        if (latestEndMs) {
          const startMs = Math.max(0, latestEndMs - window.rangeMs)
          sessionAdjustedRequest = {
            ...plannedRequest,
            start: new Date(startMs).toISOString(),
            end: new Date(latestEndMs).toISOString(),
          }
        }
      }
      const adjustedRequest = await clampToMarketSession(sessionAdjustedRequest)
      const response = await provider.fetchMarketSeries(adjustedRequest)
      let marketSessions: MarketSessionWindow[] | null = null
      if (
        listingId &&
        normalizedRequest.listing?.listing_type === 'default' &&
        (sessionPref === 'regular' || sessionPref === 'extended')
      ) {
        const bounds = resolveSeriesBoundsMs(response)
        if (bounds) {
          marketSessions = await resolveMarketSessionsForRange(
            listingId,
            normalizedRequest.listing.listing_type,
            bounds.startMs,
            bounds.endMs
          )
        }
      }
      const sessionInterval =
        adjustedRequest.interval ||
        (adjustedRequest.providerParams?.interval as string | undefined)
      const shouldFilterSessions =
        marketSessions &&
        sessionPref &&
        isIntradayInterval(sessionInterval)
      const filteredResponse = shouldFilterSessions
        ? filterSeriesBySessions(response, marketSessions, sessionPref)
        : response
      const adjusted = applySeriesWindow(filteredResponse, window)
      if (marketSessions) {
        const adjustedBounds = resolveSeriesBoundsMs(adjusted)
        if (adjustedBounds) {
          marketSessions = filterSessionsToRange(
            marketSessions,
            adjustedBounds.startMs,
            adjustedBounds.endMs
          )
        }
      }
      const adjustedWithSessions =
        marketSessions !== null ? { ...adjusted, marketSessions } : adjusted
      const allowEmpty = normalizedRequest.providerParams?.allowEmpty === true
      if (
        !Array.isArray((adjustedWithSessions as MarketSeries).bars) ||
        adjustedWithSessions.bars.length === 0
      ) {
        if (allowEmpty) {
          return adjustedWithSessions
        }
        throw new MarketProviderError({
          code: 'EMPTY SERIES',
          message: 'No data returned for the requested time range',
          provider: providerId,
          status: 422,
        })
      }
      return adjustedWithSessions
    }
    case 'live': {
      if (!provider.fetchMarketLive) {
        throw new MarketProviderError({
          code: 'INVALID REQUEST',
          message: `Provider ${providerId} does not support live market data`,
          provider: providerId,
          status: 400,
        })
      }
      return provider.fetchMarketLive(request)
    }
    default: {
      const kind = (request as { kind?: string }).kind ?? 'unknown'
      logger.warn('Unknown market request kind', { providerId, kind })
      throw new MarketProviderError({
        code: 'INVALID REQUEST',
        message: `Unsupported market request kind: ${kind}`,
        provider: providerId,
        status: 400,
      })
    }
  }
}

export * from './providers'

const INTRADAY_INTERVAL_UNITS = new Set(['m', 'h'])

const isIntradayInterval = (value?: string | null): boolean => {
  if (!value) return true
  const normalized = String(value).trim().toLowerCase()
  const match = normalized.match(/^(\d+)\s*(m|h|d|w|mo|y)$/)
  if (match?.[2]) {
    return INTRADAY_INTERVAL_UNITS.has(match[2])
  }
  if (
    normalized.includes('day') ||
    normalized.includes('week') ||
    normalized.includes('month') ||
    normalized.includes('year')
  ) {
    return false
  }
  return true
}
