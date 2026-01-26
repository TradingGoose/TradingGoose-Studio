import type {
  TradingHoldingsInput,
  TradingRequestConfig,
  TradingHoldingsNormalizationContext,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPosition,
  UnifiedTradingSymbol,
} from '@/providers/trading/types'
import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'

const DEFAULT_BASE_CURRENCY = 'USD'

const toNumber = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const sumNumbers = (values: Array<number | undefined>): number =>
  values.reduce((total, value) => (typeof value === 'number' ? total + value : total), 0)

const mapSide = (value: unknown): UnifiedTradingPosition['side'] => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'long') return 'long'
  if (normalized === 'short') return 'short'
  if (normalized === 'flat') return 'flat'
  return 'unknown'
}

const mapAssetClass = (value: unknown): UnifiedTradingSymbol['assetClass'] => {
  switch (value) {
    case 'crypto':
      return 'crypto'
    case 'us_equity':
    case 'us_option':
      return 'stock'
    default:
      return 'stock'
  }
}

const parseSymbol = (symbol?: string, assetClass?: UnifiedTradingSymbol['assetClass']) => {
  if (!symbol) {
    return { base: 'UNKNOWN', quote: DEFAULT_BASE_CURRENCY }
  }

  if (assetClass === 'crypto' && symbol.includes('/')) {
    const [base, quote] = symbol.split('/')
    return {
      base: base || symbol,
      quote: quote || DEFAULT_BASE_CURRENCY,
    }
  }

  if (symbol.includes('/')) {
    const [base, quote] = symbol.split('/')
    return {
      base: base || symbol,
      quote: quote || DEFAULT_BASE_CURRENCY,
    }
  }

  return { base: symbol, quote: DEFAULT_BASE_CURRENCY }
}

const getCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD':
      return '$'
    case 'EUR':
      return 'EUR'
    case 'GBP':
      return 'GBP'
    case 'JPY':
      return 'JPY'
    default:
      return undefined
  }
}

export const buildAlpacaHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
  const authHeaders = buildAlpacaAuthHeaders(params)

  const baseUrl =
    params.environment === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'

  return {
    url: `${baseUrl}/v2/positions`,
    method: 'GET',
    headers: authHeaders,
  }
}

export const normalizeAlpacaHoldings = (
  data: any,
  context?: TradingHoldingsNormalizationContext
): UnifiedTradingAccountSnapshot => {
  const positions = Array.isArray(data) ? data : data?.positions || data
  const list = Array.isArray(positions) ? positions : []

  const normalizedPositions: UnifiedTradingPosition[] = list.map((position: any) => {
    const assetClass = mapAssetClass(position?.asset_class)
    const symbolValue = typeof position?.symbol === 'string' ? position.symbol : undefined
    const { base, quote } = parseSymbol(symbolValue, assetClass)
    const side = mapSide(position?.side)
    const rawQuantity = toNumber(position?.qty ?? position?.quantity) ?? 0
    const quantity = side === 'short' ? -Math.abs(rawQuantity) : rawQuantity
    const marketValue = toNumber(position?.market_value)
    const unrealizedPnlPercent = toNumber(position?.unrealized_plpc)
    const conversionRate = quote === DEFAULT_BASE_CURRENCY ? 1 : undefined

    return {
      symbol: {
        base,
        quote,
        name: null,
        primaryMicId: null,
        secondaryMicIds: [],
        assetClass,
        active: true,
        rank: 0,
      },
      quantity,
      side,
      averagePrice: toNumber(position?.avg_entry_price),
      marketPrice: toNumber(position?.current_price),
      marketValue,
      currencySymbol: getCurrencySymbol(quote),
      conversionRate,
      unrealizedPnl: toNumber(position?.unrealized_pl),
      unrealizedPnlPercent:
        typeof unrealizedPnlPercent === 'number' ? unrealizedPnlPercent * 100 : undefined,
      costBasis: toNumber(position?.cost_basis),
      multiplier: 1,
    }
  })

  const totalHoldingsValue = sumNumbers(
    normalizedPositions.map((position) => position.marketValue)
  )
  const totalUnrealizedPnl = sumNumbers(
    normalizedPositions.map((position) => position.unrealizedPnl)
  )
  const totalCashValue = 0
  const totalPortfolioValue = totalHoldingsValue + totalCashValue

  return {
    asOf: new Date().toISOString(),
    provider: {
      name: context?.providerName ?? 'Alpaca',
      environment: context?.environment ?? 'unknown',
    },
    account: {
      id: context?.accountId || 'unknown',
      type: 'unknown',
      baseCurrency: DEFAULT_BASE_CURRENCY,
      status: 'unknown',
    },
    cashBalances: [],
    positions: normalizedPositions,
    orders: [],
    accountSummary: {
      totalPortfolioValue,
      totalCashValue,
      totalHoldingsValue,
      totalUnrealizedPnl,
      equity: totalPortfolioValue,
    },
    extra: {
      rawPositions: list,
    },
  }
}
