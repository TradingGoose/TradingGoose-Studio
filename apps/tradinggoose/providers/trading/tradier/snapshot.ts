import { buildPortfolioDetail } from '@/providers/trading/portfolio-detail'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import { normalizeTradierTradingAccount } from '@/providers/trading/tradier/accounts'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
import {
  extractTradierBalances,
  extractTradierPositions,
  getTradierCurrencySymbol,
  mapTradierAccountType,
  normalizeTradierPositions,
  TRADIER_DEFAULT_BASE_CURRENCY,
} from '@/providers/trading/tradier/positions'
import type { TradingPortfolioAccountContext } from '@/providers/trading/types'

async function fetchTradierBalances(context: TradingPortfolioAccountContext) {
  const baseUrl = resolveTradierBaseUrl()
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
  const baseUrl = resolveTradierBaseUrl()
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
): Promise<PortfolioDetail> {
  const [balancesResponse, positionsResponse] = await Promise.all([
    fetchTradierBalances(context),
    fetchTradierPositions(context),
  ])

  const rawPositions = extractTradierPositions(positionsResponse)
  const balances = extractTradierBalances(balancesResponse)
  const positions = normalizeTradierPositions(rawPositions)

  const totalHoldingsValue = toFiniteNumber(balances?.market_value)
  const totalCashValue = toFiniteNumber(balances?.total_cash) ?? 0
  const totalPortfolioValue =
    toFiniteNumber(balances?.total_equity) ?? (totalHoldingsValue ?? 0) + totalCashValue
  const equity = toFiniteNumber(balances?.equity) ?? totalPortfolioValue
  const totalUnrealizedPnl = toFiniteNumber(balances?.open_pl)
  const providerAccountType =
    typeof balances?.account_type === 'string' ? balances.account_type.toLowerCase() : ''
  const buyingPower =
    providerAccountType === 'cash'
      ? toFiniteNumber(balances?.cash?.cash_available)
      : providerAccountType === 'margin' || providerAccountType === 'pdt'
        ? toFiniteNumber(balances?.[providerAccountType]?.stock_buying_power)
        : undefined
  const identity = normalizeTradierTradingAccount(
    {
      account_number:
        (typeof balances?.account_number === 'string' && balances.account_number.trim()) ||
        context.accountId,
      classification: balances?.account_type,
      type: balances?.account_type,
      status: balances?.status,
    },
    context
  )

  return buildPortfolioDetail({
    identity: {
      ...identity,
      accountType: mapTradierAccountType(balances?.account_type),
      baseCurrency: TRADIER_DEFAULT_BASE_CURRENCY,
      accountStatus: identity.accountStatus ?? 'unknown',
    },
    environment: context.environment ?? 'live',
    asOf: new Date().toISOString(),
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
    summary: {
      totalCashValue,
      totalHoldingsValue,
      totalPortfolioValue,
      equity,
      buyingPower,
      marginUsed: toFiniteNumber(balances?.current_requirement),
      totalRealizedPnl: toFiniteNumber(balances?.close_pl),
      totalUnrealizedPnl,
    },
  })
}
