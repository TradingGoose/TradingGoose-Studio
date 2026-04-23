import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
import {
  extractTradierBalances,
  extractTradierPositions,
  getTradierCurrencySymbol,
  mapTradierAccountType,
  normalizeTradierPositions,
  sumTradierPositionCostBasis,
  sumTradierPositionMarketValues,
  sumTradierPositionUnrealizedPnl,
  TRADIER_DEFAULT_BASE_CURRENCY,
} from '@/providers/trading/tradier/positions'
import type {
  TradingPortfolioAccountContext,
  UnifiedTradingAccountSnapshot,
} from '@/providers/trading/types'

async function fetchTradierBalances(context: TradingPortfolioAccountContext) {
  const baseUrl = resolveTradierBaseUrl(context.environment)
  return fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/accounts/${context.accountId}/balances`,
    init: {
      method: 'GET',
      headers: {
        ...buildTradierAuthHeaders({ accessToken: context.accessToken }),
        Accept: 'application/json',
      },
    },
  })
}

async function fetchTradierPositions(context: TradingPortfolioAccountContext) {
  const baseUrl = resolveTradierBaseUrl(context.environment)
  return fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/accounts/${context.accountId}/positions`,
    init: {
      method: 'GET',
      headers: {
        ...buildTradierAuthHeaders({ accessToken: context.accessToken }),
        Accept: 'application/json',
      },
    },
  })
}

export async function getTradierTradingAccountSnapshot(
  context: TradingPortfolioAccountContext
): Promise<UnifiedTradingAccountSnapshot> {
  const [balancesResponse, positionsResponse] = await Promise.all([
    fetchTradierBalances(context),
    fetchTradierPositions(context),
  ])

  const rawPositions = extractTradierPositions(positionsResponse)
  const balancePayload = extractTradierBalances(balancesResponse)
  const balances = balancePayload?.balances
  const margin = balancePayload?.margin
  const cash = balancePayload?.cash
  const positions = normalizeTradierPositions(rawPositions)

  const positionMarketValues = sumTradierPositionMarketValues(positions)
  const positionCostBasis = sumTradierPositionCostBasis(positions)
  const totalHoldingsValue =
    toFiniteNumber(balances?.market_value) ??
    toFiniteNumber(balances?.long_market_value) ??
    (positions.some((position) => typeof position.marketValue === 'number')
      ? positionMarketValues
      : positionCostBasis)

  const totalCashValue =
    toFiniteNumber(balances?.total_cash) ?? toFiniteNumber(cash?.cash_available) ?? 0
  const totalPortfolioValue =
    toFiniteNumber(balances?.total_equity) ?? totalHoldingsValue + totalCashValue
  const equity = toFiniteNumber(balances?.equity) ?? totalPortfolioValue
  const totalUnrealizedPnl =
    toFiniteNumber(balances?.open_pl) ?? sumTradierPositionUnrealizedPnl(positions)

  return {
    asOf: new Date().toISOString(),
    provider: {
      name: 'Tradier',
      environment: context.environment ?? 'unknown',
    },
    account: {
      id:
        (typeof balances?.account_number === 'string' && balances.account_number.trim()) ||
        context.accountId,
      type: mapTradierAccountType(balances?.account_type),
      baseCurrency: TRADIER_DEFAULT_BASE_CURRENCY,
      status: 'unknown',
    },
    cashBalances: [
      {
        currency: TRADIER_DEFAULT_BASE_CURRENCY,
        currencySymbol: getTradierCurrencySymbol(TRADIER_DEFAULT_BASE_CURRENCY),
        amount: totalCashValue,
        conversionRate: 1,
        amountInAccountCurrency: totalCashValue,
      },
    ],
    positions,
    orders: [],
    accountSummary: {
      totalCashValue,
      totalHoldingsValue,
      totalPortfolioValue,
      equity,
      buyingPower:
        toFiniteNumber(margin?.stock_buying_power) ?? toFiniteNumber(balances?.stock_buying_power),
      marginUsed: toFiniteNumber(balances?.current_requirement),
      totalRealizedPnl: toFiniteNumber(balances?.close_pl),
      totalUnrealizedPnl,
    },
  }
}
