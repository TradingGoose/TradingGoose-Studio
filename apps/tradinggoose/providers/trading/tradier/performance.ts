import {
  buildTradingPortfolioPerformance,
  createUnavailableTradingPortfolioPerformance,
  fetchBrokerJson,
  toFiniteNumber,
} from '@/providers/trading/portfolio-utils'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
import type {
  TradingPortfolioAccountContext,
  TradingPortfolioPerformanceWindow,
  UnifiedTradingPortfolioPerformance,
  UnifiedTradingPortfolioPerformancePoint,
} from '@/providers/trading/types'

export const TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS: TradingPortfolioPerformanceWindow[] = [
  '1W',
  '1M',
  'YTD',
  '1Y',
  'MAX',
]

export const mapTradierPerformanceWindow = (window: TradingPortfolioPerformanceWindow): string => {
  switch (window) {
    case '1W':
      return 'WEEK'
    case '1M':
      return 'MONTH'
    case 'YTD':
      return 'YTD'
    case '1Y':
      return 'YEAR'
    case 'MAX':
      return 'ALL'
    default:
      throw new Error(`Unsupported Tradier performance window: ${window}`)
  }
}

const normalizeTradierPerformanceDate = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T12:00:00.000Z`
  }

  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return new Date(parsed).toISOString()
}

const toTradierHistoryRows = (historyResponse: any) => {
  const rows =
    historyResponse?.history?.day ??
    historyResponse?.history?.row ??
    historyResponse?.history?.balance ??
    historyResponse?.history ??
    []

  if (Array.isArray(rows)) return rows
  if (!rows) return []
  return [rows]
}

export const normalizeTradierHistoricalBalancesResponse = ({
  historyResponse,
  window,
}: {
  historyResponse: any
  window: TradingPortfolioPerformanceWindow
}): UnifiedTradingPortfolioPerformance => {
  const rows = toTradierHistoryRows(historyResponse)
  const series: UnifiedTradingPortfolioPerformancePoint[] = []

  for (const row of rows) {
    const date = typeof row?.date === 'string' ? row.date.trim() : ''
    const timestamp = normalizeTradierPerformanceDate(date)
    const equity = toFiniteNumber(row?.value)
    if (!timestamp || typeof equity !== 'number') {
      continue
    }

    series.push({
      timestamp,
      equity,
    })
  }

  series.sort((left, right) => left.timestamp.localeCompare(right.timestamp))

  return buildTradingPortfolioPerformance({
    window,
    supportedWindows: TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
    series,
    currency: 'USD',
    unavailableReason: 'No usable performance data returned by broker',
  })
}

export async function getTradierTradingAccountPerformance(
  context: TradingPortfolioAccountContext & { window: TradingPortfolioPerformanceWindow }
): Promise<UnifiedTradingPortfolioPerformance> {
  if (context.environment === 'paper') {
    return createUnavailableTradingPortfolioPerformance({
      window: context.window,
      supportedWindows: TRADIER_SUPPORTED_TRADING_PORTFOLIO_WINDOWS,
      unavailableReason: 'Tradier paper performance is not implemented in portfolio_snapshot v1',
    })
  }

  const baseUrl = resolveTradierBaseUrl(context.environment)
  const period = mapTradierPerformanceWindow(context.window)
  const historyResponse = await fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/accounts/${context.accountId}/historical-balances?period=${period}`,
    init: {
      method: 'GET',
      headers: {
        ...buildTradierAuthHeaders({ accessToken: context.accessToken }),
        Accept: 'application/json',
      },
    },
  })

  return normalizeTradierHistoricalBalancesResponse({
    historyResponse,
    window: context.window,
  })
}
