import type {
  TradingHoldingsInput,
  TradingRequestConfig,
  TradingHoldingsNormalizationContext,
  UnifiedTradingAccountSnapshot,
  UnifiedTradingPosition,
  UnifiedTradingSymbol,
} from '@/providers/trading/types'

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

export const buildTradierHoldingsRequest = (
  params: TradingHoldingsInput
): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Tradier access token is required')
  }
  if (!params.accountId) {
    throw new Error('Tradier account ID is required')
  }

  return {
    url: `https://api.tradier.com/v1/accounts/${params.accountId}/positions`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  }
}

export const normalizeTradierHoldings = (
  data: any,
  context?: TradingHoldingsNormalizationContext
): UnifiedTradingAccountSnapshot => {
  const positions = data?.positions?.position || data?.position || []
  const list = Array.isArray(positions) ? positions : [positions].filter(Boolean)

  const normalizedPositions: UnifiedTradingPosition[] = list.map((position: any) => {
    const quantity = toNumber(position?.quantity) ?? 0
    const marketValue = toNumber(position?.market_value)
    const side = quantity === 0 ? 'flat' : quantity < 0 ? 'short' : 'long'

    return {
      symbol: buildSymbol(position?.symbol),
      quantity,
      side,
      averagePrice: toNumber(position?.cost_basis),
      marketValue,
      currencySymbol: getCurrencySymbol(DEFAULT_BASE_CURRENCY),
      conversionRate: 1,
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
      name: context?.providerName ?? 'Tradier',
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
