import type {
  TradingPortfolioPerformanceWindow,
  UnifiedTradingPortfolioPerformance,
  UnifiedTradingPortfolioPerformancePoint,
  UnifiedTradingPortfolioPerformanceSummary,
} from '@/providers/trading/types'

export class TradingBrokerRequestError extends Error {
  status: number
  providerId: string
  url: string
  payload?: unknown

  constructor(input: {
    message: string
    providerId: string
    status: number
    url: string
    payload?: unknown
  }) {
    super(input.message)
    this.name = 'TradingBrokerRequestError'
    this.status = input.status
    this.providerId = input.providerId
    this.url = input.url
    this.payload = input.payload
  }
}

export const toFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const sumFiniteNumbers = (values: Array<number | undefined>): number =>
  values.reduce<number>((total, value) => (typeof value === 'number' ? total + value : total), 0)

export const createUnavailableTradingPortfolioPerformance = ({
  window,
  supportedWindows,
  unavailableReason,
}: {
  window: TradingPortfolioPerformanceWindow
  supportedWindows: TradingPortfolioPerformanceWindow[]
  unavailableReason: string
}): UnifiedTradingPortfolioPerformance => ({
  window,
  supportedWindows,
  series: [],
  summary: null,
  unavailableReason,
})

export const buildTradingPortfolioPerformanceSummary = (
  series: UnifiedTradingPortfolioPerformancePoint[],
  currency: string
): UnifiedTradingPortfolioPerformanceSummary | null => {
  if (series.length === 0) {
    return null
  }

  const startPoint = series[0]
  const endPoint = series[series.length - 1]
  if (!startPoint || !endPoint) {
    return null
  }

  let highEquity = startPoint.equity
  let lowEquity = startPoint.equity

  for (const point of series) {
    if (point.equity > highEquity) {
      highEquity = point.equity
    }
    if (point.equity < lowEquity) {
      lowEquity = point.equity
    }
  }

  const absoluteReturn = endPoint.equity - startPoint.equity
  const percentReturn =
    series.length < 2 || startPoint.equity === 0 ? null : (absoluteReturn / startPoint.equity) * 100

  return {
    currency,
    startEquity: startPoint.equity,
    endEquity: endPoint.equity,
    highEquity,
    lowEquity,
    absoluteReturn: series.length < 2 ? 0 : absoluteReturn,
    percentReturn,
    asOf: endPoint.timestamp,
  }
}

export const buildTradingPortfolioPerformance = ({
  window,
  supportedWindows,
  series,
  currency,
  unavailableReason,
}: {
  window: TradingPortfolioPerformanceWindow
  supportedWindows: TradingPortfolioPerformanceWindow[]
  series: UnifiedTradingPortfolioPerformancePoint[]
  currency: string
  unavailableReason?: string
}): UnifiedTradingPortfolioPerformance => {
  const summary = buildTradingPortfolioPerformanceSummary(series, currency)

  if (!summary) {
    return createUnavailableTradingPortfolioPerformance({
      window,
      supportedWindows,
      unavailableReason: unavailableReason ?? 'No usable performance data returned by broker',
    })
  }

  return {
    window,
    supportedWindows,
    series,
    summary,
  }
}

export async function fetchBrokerJson<T>({
  providerId,
  url,
  init,
}: {
  providerId: string
  url: string
  init?: RequestInit
}): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new TradingBrokerRequestError({
      message: error instanceof Error ? error.message : 'Broker request failed',
      providerId,
      status: 0,
      url,
    })
  }

  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new TradingBrokerRequestError({
      message: `Broker request failed with status ${response.status}`,
      providerId,
      status: response.status,
      url,
      payload,
    })
  }

  return payload as T
}
