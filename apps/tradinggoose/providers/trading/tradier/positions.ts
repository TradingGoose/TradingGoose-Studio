import { sumFiniteNumbers, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import type {
  TradingHoldingsInput,
  TradingHoldingsNormalizationContext,
  TradingRequestConfig,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingAccountType,
  UnifiedTradingPosition,
} from '@/providers/trading/types'
import { tradingSymbolToListingIdentity } from '@/providers/trading/utils'

export const TRADIER_DEFAULT_BASE_CURRENCY = 'USD'

export const getTradierCurrencySymbol = (currency?: string) => {
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

export const mapTradierAccountType = (value: unknown): UnifiedTradingAccountType => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'margin') return 'margin'
  if (normalized === 'cash') return 'cash'
  return 'unknown'
}

export const extractTradierPositions = (data: any) => {
  const positions = data?.positions?.position || data?.positions || data?.position || []
  if (Array.isArray(positions)) return positions
  if (!positions) return []
  return [positions]
}

export const extractTradierBalances = (data: any) => {
  if (!data || typeof data !== 'object') return undefined
  if (data.balance && typeof data.balance === 'object') {
    return {
      balances: data.balance.balances || data.balance,
      margin: data.balance.margin,
      cash: data.balance.cash,
      pdt: data.balance.pdt,
    }
  }
  if (data.balances && typeof data.balances === 'object') {
    const balances = data.balances
    if (
      balances.account_number ||
      balances.total_equity ||
      balances.total_cash ||
      data.margin ||
      data.cash
    ) {
      return {
        balances,
        margin: data.margin,
        cash: data.cash,
        pdt: data.pdt,
      }
    }
  }
  return undefined
}

export const normalizeTradierPositions = (positions: unknown): UnifiedTradingPosition[] => {
  const list = Array.isArray(positions) ? positions : []

  return list.map((position: any) => {
    const resolvedSymbol = tradingSymbolToListingIdentity(tradierTradingProviderConfig, {
      symbol: typeof position?.symbol === 'string' ? position.symbol : undefined,
      assetClass: 'stock',
      defaultQuote: TRADIER_DEFAULT_BASE_CURRENCY,
    })
    const quantity = toFiniteNumber(position?.quantity) ?? 0
    const marketValue = toFiniteNumber(position?.market_value)
    const costBasis = toFiniteNumber(position?.cost_basis)
    const averagePrice =
      typeof costBasis === 'number' && quantity !== 0 ? Math.abs(costBasis / quantity) : undefined
    const side = quantity === 0 ? 'flat' : quantity < 0 ? 'short' : 'long'
    const openedAt =
      typeof position?.date_acquired === 'string' ? position.date_acquired : undefined

    return {
      symbol: {
        base: resolvedSymbol?.base ?? 'UNKNOWN',
        quote: resolvedSymbol?.quote ?? TRADIER_DEFAULT_BASE_CURRENCY,
        listing: resolvedSymbol?.listing,
        name: null,
        assetClass: resolvedSymbol?.assetClass ?? 'stock',
        active: true,
        rank: 0,
      },
      quantity,
      side,
      averagePrice,
      marketValue,
      currencySymbol: getTradierCurrencySymbol(TRADIER_DEFAULT_BASE_CURRENCY),
      conversionRate: 1,
      costBasis,
      openedAt,
    }
  })
}

export const sumTradierPositionMarketValues = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.marketValue))

export const sumTradierPositionCostBasis = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.costBasis))

export const sumTradierPositionUnrealizedPnl = (positions: UnifiedTradingPosition[]) =>
  sumFiniteNumbers(positions.map((position) => position.unrealizedPnl))

export const buildTradierHoldingsRequest = (params: TradingHoldingsInput): TradingRequestConfig => {
  if (!params.accountId) {
    throw new Error('Tradier account ID is required')
  }

  const authHeaders = buildTradierAuthHeaders(params)
  const baseUrl = resolveTradierBaseUrl(params.environment)
  const resource = params.providerParams?.resource === 'balances' ? 'balances' : 'positions'

  return {
    url: `${baseUrl}/accounts/${params.accountId}/${resource}`,
    method: 'GET',
    headers: {
      ...authHeaders,
      Accept: 'application/json',
    },
  }
}

export const normalizeTradierHoldings = (
  data: any,
  context?: TradingHoldingsNormalizationContext
): UnifiedTradingAccountSnapshot => {
  const list = extractTradierPositions(data)
  const balancePayload = extractTradierBalances(data)
  const balances = balancePayload?.balances
  const margin = balancePayload?.margin
  const cash = balancePayload?.cash
  const normalizedPositions = normalizeTradierPositions(list)

  const totalHoldingsValueFromPositions = sumTradierPositionMarketValues(normalizedPositions)
  const totalCostBasis = sumTradierPositionCostBasis(normalizedPositions)
  const hasMarketValues = normalizedPositions.some(
    (position) => typeof position.marketValue === 'number'
  )

  const totalHoldingsValueFromBalances =
    toFiniteNumber(balances?.market_value) ?? toFiniteNumber(balances?.long_market_value)
  const totalHoldingsValue =
    totalHoldingsValueFromBalances ??
    (hasMarketValues ? totalHoldingsValueFromPositions : totalCostBasis)

  const totalUnrealizedPnl =
    toFiniteNumber(balances?.open_pl) ?? sumTradierPositionUnrealizedPnl(normalizedPositions)
  const totalRealizedPnl = toFiniteNumber(balances?.close_pl)
  const totalCashValue =
    toFiniteNumber(balances?.total_cash) ?? toFiniteNumber(cash?.cash_available) ?? 0
  const totalPortfolioValue =
    toFiniteNumber(balances?.total_equity) ?? totalHoldingsValue + totalCashValue

  const cashBalances =
    toFiniteNumber(balances?.total_cash) !== undefined ||
    toFiniteNumber(cash?.cash_available) !== undefined
      ? [
          {
            currency: TRADIER_DEFAULT_BASE_CURRENCY,
            currencySymbol: getTradierCurrencySymbol(TRADIER_DEFAULT_BASE_CURRENCY),
            amount: totalCashValue,
            conversionRate: 1,
            amountInAccountCurrency: totalCashValue,
          },
        ]
      : []

  return {
    asOf: new Date().toISOString(),
    provider: {
      name: context?.providerName ?? 'Tradier',
      environment: context?.environment ?? 'unknown',
    },
    account: {
      id: balances?.account_number || context?.accountId || 'unknown',
      type: mapTradierAccountType(balances?.account_type),
      baseCurrency: TRADIER_DEFAULT_BASE_CURRENCY,
      status: 'unknown',
    },
    cashBalances,
    positions: normalizedPositions,
    orders: [],
    accountSummary: {
      totalPortfolioValue,
      totalCashValue,
      totalHoldingsValue,
      totalUnrealizedPnl,
      totalRealizedPnl,
      marginUsed: toFiniteNumber(balances?.current_requirement),
      buyingPower:
        toFiniteNumber(margin?.stock_buying_power) ?? toFiniteNumber(balances?.stock_buying_power),
      equity: toFiniteNumber(balances?.equity) ?? totalPortfolioValue,
    },
    extra: {
      rawPositions: list,
      rawBalances: balancePayload,
    },
  }
}
