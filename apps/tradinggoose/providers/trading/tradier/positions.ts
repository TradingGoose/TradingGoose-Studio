import type {
  TradingHoldingsInput,
  TradingRequestConfig,
  TradingHoldingsNormalizationContext,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPosition,
  UnifiedTradingSymbol,
  UnifiedTradingAccountType,
} from '@/providers/trading/types'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'

const DEFAULT_BASE_CURRENCY = 'USD'

const toNumber = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const sumNumbers = (values: Array<number | undefined>): number =>
  values.reduce((total, value) => (typeof value === 'number' ? total + value : total), 0)

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

const buildSymbol = (symbol?: string): UnifiedTradingSymbol => ({
  base: symbol || 'UNKNOWN',
  quote: DEFAULT_BASE_CURRENCY,
  name: null,
  primaryMicId: null,
  secondaryMicIds: [],
  assetClass: 'stock',
  active: true,
  rank: 0,
})

const mapAccountType = (value: unknown): UnifiedTradingAccountType => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized === 'margin') return 'margin'
  if (normalized === 'cash') return 'cash'
  return 'unknown'
}

const extractPositions = (data: any) => {
  const positions = data?.positions?.position || data?.positions || data?.position || []
  if (Array.isArray(positions)) return positions
  if (!positions) return []
  return [positions]
}

const extractBalances = (data: any) => {
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

export const buildTradierHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
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
  const list = extractPositions(data)
  const balancePayload = extractBalances(data)
  const balances = balancePayload?.balances
  const margin = balancePayload?.margin
  const cash = balancePayload?.cash

  const normalizedPositions: UnifiedTradingPosition[] = list.map((position: any) => {
    const quantity = toNumber(position?.quantity) ?? 0
    const marketValue = toNumber(position?.market_value)
    const costBasis = toNumber(position?.cost_basis)
    const averagePrice =
      typeof costBasis === 'number' && quantity !== 0
        ? Math.abs(costBasis / quantity)
        : undefined
    const side = quantity === 0 ? 'flat' : quantity < 0 ? 'short' : 'long'
    const openedAt =
      typeof position?.date_acquired === 'string' ? position.date_acquired : undefined

    return {
      symbol: buildSymbol(position?.symbol),
      quantity,
      side,
      averagePrice,
      marketValue,
      currencySymbol: getCurrencySymbol(DEFAULT_BASE_CURRENCY),
      conversionRate: 1,
      costBasis,
      openedAt,
    }
  })

  const totalHoldingsValueFromPositions = sumNumbers(
    normalizedPositions.map((position) => position.marketValue)
  )
  const totalCostBasis = sumNumbers(normalizedPositions.map((position) => position.costBasis))
  const hasMarketValues = normalizedPositions.some(
    (position) => typeof position.marketValue === 'number'
  )

  const totalHoldingsValueFromBalances =
    toNumber(balances?.market_value) ?? toNumber(balances?.long_market_value)
  const totalHoldingsValue =
    totalHoldingsValueFromBalances ??
    (hasMarketValues ? totalHoldingsValueFromPositions : totalCostBasis)

  const totalUnrealizedPnlFromPositions = sumNumbers(
    normalizedPositions.map((position) => position.unrealizedPnl)
  )
  const totalUnrealizedPnl =
    toNumber(balances?.open_pl) ?? totalUnrealizedPnlFromPositions
  const totalRealizedPnl = toNumber(balances?.close_pl)
  const totalCashValue =
    toNumber(balances?.total_cash) ?? toNumber(cash?.cash_available) ?? 0
  const totalPortfolioValue =
    toNumber(balances?.total_equity) ?? totalHoldingsValue + totalCashValue

  const cashBalances =
    toNumber(balances?.total_cash) !== undefined || toNumber(cash?.cash_available) !== undefined
      ? [
          {
            currency: DEFAULT_BASE_CURRENCY,
            currencySymbol: getCurrencySymbol(DEFAULT_BASE_CURRENCY),
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
      type: mapAccountType(balances?.account_type),
      baseCurrency: DEFAULT_BASE_CURRENCY,
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
      marginUsed: toNumber(balances?.current_requirement),
      buyingPower:
        toNumber(margin?.stock_buying_power) ?? toNumber(balances?.stock_buying_power),
      equity: toNumber(balances?.equity) ?? totalPortfolioValue,
    },
    extra: {
      rawPositions: list,
      rawBalances: balancePayload,
    },
  }
}
