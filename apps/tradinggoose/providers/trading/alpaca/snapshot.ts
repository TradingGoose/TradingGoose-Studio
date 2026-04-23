import {
  fetchAlpacaTradingAccount,
  normalizeAlpacaSnapshotAccountSummary,
  normalizeAlpacaTradingAccount,
  resolveAlpacaTradingBaseUrl,
} from '@/providers/trading/alpaca/accounts'
import {
  ALPACA_DEFAULT_BASE_CURRENCY,
  getAlpacaCurrencySymbol,
  normalizeAlpacaPositions,
  sumAlpacaPositionUnrealizedPnl,
} from '@/providers/trading/alpaca/positions'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioAccountContext,
  UnifiedTradingAccountSnapshot,
} from '@/providers/trading/types'

async function fetchAlpacaTradingPositions(context: TradingPortfolioAccountContext) {
  const baseUrl = resolveAlpacaTradingBaseUrl(context.environment)
  return fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/v2/positions`,
    init: {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
      },
    },
  })
}

export async function getAlpacaTradingAccountSnapshot(
  context: TradingPortfolioAccountContext
): Promise<UnifiedTradingAccountSnapshot> {
  const [accountResponse, positionsResponse] = await Promise.all([
    fetchAlpacaTradingAccount(context),
    fetchAlpacaTradingPositions(context),
  ])

  const account = normalizeAlpacaTradingAccount(accountResponse, context.environment)
  const rawPositions = Array.isArray(positionsResponse) ? positionsResponse : []
  const positions = normalizeAlpacaPositions(rawPositions)
  const summaryTotals = normalizeAlpacaSnapshotAccountSummary(accountResponse)
  const totalUnrealizedPnl = sumAlpacaPositionUnrealizedPnl(positions)
  const totalHoldingsValue = summaryTotals.totalPortfolioValue - summaryTotals.totalCashValue

  return {
    asOf: new Date().toISOString(),
    provider: {
      name: 'Alpaca',
      environment: context.environment ?? 'unknown',
    },
    account: {
      ...account,
      baseCurrency: account.baseCurrency || ALPACA_DEFAULT_BASE_CURRENCY,
    },
    cashBalances: [
      {
        currency: account.baseCurrency,
        currencySymbol: getAlpacaCurrencySymbol(account.baseCurrency),
        amount: summaryTotals.totalCashValue,
        conversionRate: account.baseCurrency === ALPACA_DEFAULT_BASE_CURRENCY ? 1 : undefined,
        amountInAccountCurrency: summaryTotals.totalCashValue,
      },
    ],
    positions,
    orders: [],
    accountSummary: {
      totalPortfolioValue: summaryTotals.totalPortfolioValue,
      totalCashValue: summaryTotals.totalCashValue,
      totalHoldingsValue,
      totalUnrealizedPnl,
      buyingPower: summaryTotals.buyingPower,
      equity: summaryTotals.equity,
    },
  }
}
