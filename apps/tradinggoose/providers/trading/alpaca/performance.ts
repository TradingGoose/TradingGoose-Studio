import {
  fetchAlpacaTradingAccount,
  normalizeAlpacaTradingAccount,
  resolveAlpacaTradingBaseUrl,
} from '@/providers/trading/alpaca/accounts'
import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'
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

export const ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS: TradingPortfolioPerformanceWindow[] = [
  '1D',
  '1W',
  '1M',
  '3M',
  'YTD',
  '1Y',
]

const getNewYorkYear = (now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
    }).format(now)
  )

export const buildAlpacaPerformanceQueryParams = (
  window: TradingPortfolioPerformanceWindow,
  now = new Date()
) => {
  const year = getNewYorkYear(now)

  switch (window) {
    case '1D':
      return {
        period: '1D',
        timeframe: '1Min',
        intraday_reporting: 'market_hours',
      }
    case '1W':
      return {
        period: '1W',
        timeframe: '1D',
      }
    case '1M':
      return {
        period: '1M',
        timeframe: '1D',
      }
    case '3M':
      return {
        period: '3M',
        timeframe: '1D',
      }
    case 'YTD':
      return {
        start: `${year}-01-01T00:00:00-05:00`,
        timeframe: '1D',
      }
    case '1Y':
      return {
        period: '1A',
        timeframe: '1D',
      }
    default:
      throw new Error(`Unsupported Alpaca performance window: ${window}`)
  }
}

const normalizeAlpacaHistoryTimestamp = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return new Date(numeric * 1000).toISOString()
  }

  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return new Date(parsed).toISOString()
}

export const normalizeAlpacaPortfolioHistoryResponse = ({
  history,
  currency,
  window,
}: {
  history: any
  currency: string
  window: TradingPortfolioPerformanceWindow
}): UnifiedTradingPortfolioPerformance => {
  const timestamps = Array.isArray(history?.timestamp) ? history.timestamp : null
  const equity = Array.isArray(history?.equity) ? history.equity : null

  if (!timestamps || !equity) {
    return createUnavailableTradingPortfolioPerformance({
      window,
      supportedWindows: ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
      unavailableReason: 'No usable performance data returned by broker',
    })
  }

  const pointCount = Math.min(timestamps.length, equity.length)
  const series: UnifiedTradingPortfolioPerformancePoint[] = []

  for (let index = 0; index < pointCount; index += 1) {
    const timestamp = normalizeAlpacaHistoryTimestamp(timestamps[index])
    const equityValue = toFiniteNumber(equity[index])
    if (!timestamp || typeof equityValue !== 'number') {
      continue
    }

    series.push({
      timestamp,
      equity: equityValue,
    })
  }

  series.sort((left, right) => left.timestamp.localeCompare(right.timestamp))

  return buildTradingPortfolioPerformance({
    window,
    supportedWindows: ALPACA_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
    series,
    currency,
    unavailableReason: 'No usable performance data returned by broker',
  })
}

export async function getAlpacaTradingAccountPerformance(
  context: TradingPortfolioAccountContext & { window: TradingPortfolioPerformanceWindow }
): Promise<UnifiedTradingPortfolioPerformance> {
  const baseUrl = resolveAlpacaTradingBaseUrl(context.environment)
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(buildAlpacaPerformanceQueryParams(context.window))) {
    if (value) {
      searchParams.set(key, value)
    }
  }

  const [accountResponse, historyResponse] = await Promise.all([
    fetchAlpacaTradingAccount(context),
    fetchBrokerJson<any>({
      providerId: context.providerId,
      url: `${baseUrl}/v2/account/portfolio/history?${searchParams.toString()}`,
      init: {
        method: 'GET',
        headers: buildAlpacaAuthHeaders({ accessToken: context.accessToken }),
      },
    }),
  ])

  const normalizedAccount = normalizeAlpacaTradingAccount(accountResponse, context.environment)

  return normalizeAlpacaPortfolioHistoryResponse({
    history: historyResponse,
    currency: normalizedAccount.baseCurrency,
    window: context.window,
  })
}
