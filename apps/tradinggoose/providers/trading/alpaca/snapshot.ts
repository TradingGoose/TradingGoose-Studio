import {
  fetchAlpacaTradingAccount,
  normalizeAlpacaSnapshotAccountSummary,
  normalizeAlpacaTradingAccount,
} from '@/providers/trading/alpaca/accounts'
import { buildPortfolioDetail } from '@/providers/trading/portfolio-detail'
import { resolveAlpacaTradingBaseUrl } from '@/providers/trading/alpaca/config'
import {
  ALPACA_DEFAULT_BASE_CURRENCY,
  getAlpacaCurrencySymbol,
  normalizeAlpacaPositions,
  sumAlpacaPositionUnrealizedPnl,
} from '@/providers/trading/alpaca/positions'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'
import type { TradingPortfolioAccountContext } from '@/providers/trading/types'

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
): Promise<PortfolioDetail> {
  const [accountResponse, positionsResponse] = await Promise.all([
    fetchAlpacaTradingAccount(context),
    fetchAlpacaTradingPositions(context),
  ])

  const account = normalizeAlpacaTradingAccount(accountResponse, context)
  const rawPositions = Array.isArray(positionsResponse) ? positionsResponse : []
  const positions = normalizeAlpacaPositions(rawPositions)
  const summaryTotals = normalizeAlpacaSnapshotAccountSummary(accountResponse)
  const totalUnrealizedPnl = sumAlpacaPositionUnrealizedPnl(positions)
  const totalHoldingsValue = summaryTotals.totalPortfolioValue - summaryTotals.totalCashValue

  return buildPortfolioDetail({
    identity: {
      ...account,
      baseCurrency: account.baseCurrency || ALPACA_DEFAULT_BASE_CURRENCY,
    },
    environment: context.environment ?? 'live',
    asOf: new Date().toISOString(),
    cashBalances: [
      {
        currency: account.baseCurrency || ALPACA_DEFAULT_BASE_CURRENCY,
        currencySymbol: getAlpacaCurrencySymbol(account.baseCurrency || ALPACA_DEFAULT_BASE_CURRENCY),
        amount: summaryTotals.totalCashValue,
        conversionRate: account.baseCurrency === ALPACA_DEFAULT_BASE_CURRENCY ? 1 : undefined,
        amountInAccountCurrency: summaryTotals.totalCashValue,
      },
    ],
    positions,
    summary: {
      totalPortfolioValue: summaryTotals.totalPortfolioValue,
      totalCashValue: summaryTotals.totalCashValue,
      totalHoldingsValue,
      totalUnrealizedPnl,
      buyingPower: summaryTotals.buyingPower,
      equity: summaryTotals.equity,
    },
  })
}
