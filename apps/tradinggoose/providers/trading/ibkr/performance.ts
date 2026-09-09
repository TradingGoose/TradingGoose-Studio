import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrAccountUrl } from '@/providers/trading/ibkr/client'
import { ibkrTradingProviderConfig } from '@/providers/trading/ibkr/config'
import {
  buildTradingPortfolioPerformance,
  createUnavailableTradingPortfolioPerformance,
  fetchBrokerJson,
  toFiniteNumber,
} from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioAccountContext,
  TradingPortfolioPerformanceWindow,
  UnifiedTradingPortfolioPerformance,
  UnifiedTradingPortfolioPerformancePoint,
} from '@/providers/trading/types'

const IBKR_PERIOD_BY_WINDOW: Partial<
  Record<TradingPortfolioPerformanceWindow, { period: string; periodType: string }>
> = {
  '1W': { period: 'W', periodType: '7D' },
  '1M': { period: 'M', periodType: '1M' },
  '3M': { period: 'M', periodType: '3M' },
  YTD: { period: 'Y', periodType: 'YTD' },
  '1Y': { period: 'Y', periodType: '1Y' },
  MAX: { period: 'Y', periodType: '5Y' },
}

const getIbkrSupportedPerformanceWindows = () =>
  ibkrTradingProviderConfig.capabilities?.portfolioDetail?.performanceWindows ?? []

const normalizeIbkrTimestamp = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return new Date(numeric * 1000).toISOString()
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export const normalizeIbkrPerformanceResponse = ({
  response,
  currency,
  window,
}: {
  response: any
  currency: string
  window: TradingPortfolioPerformanceWindow
}): UnifiedTradingPortfolioPerformance => {
  const nav = response?.nav
  const base = nav?.base
  const rawData = Array.isArray(base?.data) ? base.data : []
  const rawFreq = base?.freq ?? 'M'

  const series: UnifiedTradingPortfolioPerformancePoint[] = []
  for (const entry of rawData) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const value = toFiniteNumber(record['$']) ?? toFiniteNumber(record.value)
    const timestamp = normalizeIbkrTimestamp(record['t']) ?? normalizeIbkrTimestamp(record.t)
    if (typeof value !== 'number' || !timestamp) continue
    series.push({ timestamp, equity: value })
  }

  if (series.length === 0) {
    return createUnavailableTradingPortfolioPerformance({
      window,
      supportedWindows: getIbkrSupportedPerformanceWindows(),
      unavailableReason: 'No usable performance data returned by broker',
    })
  }

  const sorted = series.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const aggregated: UnifiedTradingPortfolioPerformancePoint[] = []
  const seen = new Map<string, UnifiedTradingPortfolioPerformancePoint>()
  for (const point of sorted) {
    const key = point.timestamp.slice(0, 10)
    const existing = seen.get(key)
    if (existing) {
      existing.equity = point.equity
    } else {
      seen.set(key, point)
      aggregated.push(point)
    }
  }

  const maxPoints = rawFreq === 'D' ? 2000 : 500
  const limited = aggregated.slice(-maxPoints)

  return buildTradingPortfolioPerformance({
    window,
    supportedWindows: getIbkrSupportedPerformanceWindows(),
    series: limited,
    currency,
    unavailableReason: 'No usable performance data returned by broker',
  })
}

export async function getIbkrTradingAccountPerformance(
  context: TradingPortfolioAccountContext & { window: TradingPortfolioPerformanceWindow }
): Promise<UnifiedTradingPortfolioPerformance> {
  const mapping = IBKR_PERIOD_BY_WINDOW[context.window]
  if (!mapping) {
    return createUnavailableTradingPortfolioPerformance({
      window: context.window,
      supportedWindows: getIbkrSupportedPerformanceWindows(),
      unavailableReason: `IBKR performance window ${context.window} is not supported`,
    })
  }

  const searchParams = new URLSearchParams({
    period: mapping.period,
    periodType: mapping.periodType,
    extended: 'false',
  })

  const response = await fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${buildIbkrAccountUrl(context.accountId, '/performance')}?${searchParams.toString()}`,
    init: {
      method: 'POST',
      headers: {
        ...buildIbkrAuthHeaders({ accessToken: context.accessToken }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  })

  const currency =
    typeof response?.currency === 'string' && response.currency.trim()
      ? response.currency.trim().toUpperCase()
      : 'USD'

  return normalizeIbkrPerformanceResponse({
    response,
    currency,
    window: context.window,
  })
}
