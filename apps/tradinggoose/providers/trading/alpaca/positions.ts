import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import { sumFiniteNumbers, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import type {
  TradingHoldingsInput,
  TradingHoldingsNormalizationContext,
  TradingRequestConfig,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPosition,
  UnifiedTradingSymbol,
} from '@/providers/trading/types'
import { tradingSymbolToListingIdentity } from '@/providers/trading/utils'

export const ALPACA_DEFAULT_BASE_CURRENCY = 'USD'

export const mapAlpacaPositionSide = (value: unknown): UnifiedTradingPosition['side'] => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'long') return 'long'
  if (normalized === 'short') return 'short'
  if (normalized === 'flat') return 'flat'
  return 'unknown'
}

export const mapAlpacaAssetClass = (value: unknown): UnifiedTradingSymbol['assetClass'] => {
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

export const getAlpacaCurrencySymbol = (currency?: string) => {
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

export const normalizeAlpacaPositions = (positions: unknown): UnifiedTradingPosition[] => {
  const list = Array.isArray(positions) ? positions : []

  return list.map((position: any) => {
    const assetClass = mapAlpacaAssetClass(position?.asset_class)
    const symbolValue = typeof position?.symbol === 'string' ? position.symbol : undefined
    const resolvedSymbol = tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
      symbol: symbolValue,
      assetClass,
      defaultQuote: ALPACA_DEFAULT_BASE_CURRENCY,
    })
    const base = resolvedSymbol?.base ?? 'UNKNOWN'
    const quote = resolvedSymbol?.quote ?? ALPACA_DEFAULT_BASE_CURRENCY
    const symbolAssetClass = resolvedSymbol?.assetClass ?? assetClass
    const side = mapAlpacaPositionSide(position?.side)
    const rawQuantity = toFiniteNumber(position?.qty ?? position?.quantity) ?? 0
    const quantity = side === 'short' ? -Math.abs(rawQuantity) : rawQuantity
    const marketValue = toFiniteNumber(position?.market_value)
    const unrealizedPnlPercent = toFiniteNumber(position?.unrealized_plpc)
    const conversionRate = quote === ALPACA_DEFAULT_BASE_CURRENCY ? 1 : undefined

    return {
      symbol: {
        base,
        quote,
        listing: resolvedSymbol?.listing,
        name: null,
        assetClass: symbolAssetClass,
        active: true,
        rank: 0,
      },
      quantity,
      side,
      averagePrice: toFiniteNumber(position?.avg_entry_price),
      marketPrice: toFiniteNumber(position?.current_price),
      marketValue,
      currencySymbol: getAlpacaCurrencySymbol(quote),
      conversionRate,
      unrealizedPnl: toFiniteNumber(position?.unrealized_pl),
      unrealizedPnlPercent:
        typeof unrealizedPnlPercent === 'number' ? unrealizedPnlPercent * 100 : undefined,
      costBasis: toFiniteNumber(position?.cost_basis),
      multiplier: 1,
    }
  })
}

export const sumAlpacaPositionMarketValues = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.marketValue))

export const sumAlpacaPositionUnrealizedPnl = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.unrealizedPnl))

export const buildAlpacaHoldingsRequest = (params: TradingHoldingsInput): TradingRequestConfig => {
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
  const normalizedPositions = normalizeAlpacaPositions(list)
  const totalHoldingsValue = sumAlpacaPositionMarketValues(normalizedPositions)
  const totalUnrealizedPnl = sumAlpacaPositionUnrealizedPnl(normalizedPositions)
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
      baseCurrency: ALPACA_DEFAULT_BASE_CURRENCY,
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
