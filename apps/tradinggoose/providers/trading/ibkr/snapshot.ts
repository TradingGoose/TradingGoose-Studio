import {
  getIbkrTradingAccounts,
  normalizeIbkrTradingAccount,
} from '@/providers/trading/ibkr/accounts'
import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrAccountUrl } from '@/providers/trading/ibkr/client'
import {
  getIbkrTradingPositions,
  IBKR_DEFAULT_BASE_CURRENCY,
  sumIbkrPositionUnrealizedPnl,
} from '@/providers/trading/ibkr/positions'
import { buildPortfolioDetail } from '@/providers/trading/portfolio-detail'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import type { TradingPortfolioAccountContext } from '@/providers/trading/types'

interface IbkrSummaryRow {
  key?: string
  value?: string | number | null
}

export const normalizeIbkrSnapshotAccountSummary = (rows: unknown) => {
  const list = Array.isArray(rows) ? rows : []
  const values = new Map<string, number | undefined>()

  for (const row of list) {
    const record = row as IbkrSummaryRow
    const key = typeof record?.key === 'string' ? record.key : undefined
    if (!key) continue
    values.set(key, toFiniteNumber(record?.value))
  }

  const totalCashValue = values.get('totalcashvalue') ?? 0
  const equity = values.get('equitywithloan') ?? values.get('netliquidation') ?? 0
  const totalPortfolioValue = values.get('netliquidation') ?? equity ?? 0
  const buyingPower = values.get('buyingpower') ?? values.get('cashbalance') ?? 0

  return {
    totalCashValue,
    totalPortfolioValue,
    equity,
    buyingPower,
  }
}

export async function getIbkrTradingAccountSnapshot(
  context: TradingPortfolioAccountContext
): Promise<PortfolioDetail> {
  const headers = buildIbkrAuthHeaders({ accessToken: context.accessToken })

  const [accountIdentity, summaryRows, positions] = await Promise.all([
    getIbkrTradingAccounts(context).then((identities) => {
      const match =
        identities.find((identity) => identity.accountId === context.accountId) ?? identities[0]
      if (!match) {
        throw new Error('IBKR account not found for connected session')
      }
      return match
    }),
    fetchBrokerJson<IbkrSummaryRow[]>({
      providerId: context.providerId,
      url: buildIbkrAccountUrl(context.accountId, '/summary'),
      init: { method: 'GET', headers },
    }),
    getIbkrTradingPositions(context),
  ])

  const account = normalizeIbkrTradingAccount(accountIdentity, context)
  const summaryTotals = normalizeIbkrSnapshotAccountSummary(summaryRows)
  const totalUnrealizedPnl = sumIbkrPositionUnrealizedPnl(positions)
  const totalHoldingsValue = summaryTotals.totalPortfolioValue - summaryTotals.totalCashValue

  return buildPortfolioDetail({
    identity: {
      ...account,
      baseCurrency: account.baseCurrency || IBKR_DEFAULT_BASE_CURRENCY,
    },
    environment: context.environment ?? 'live',
    asOf: new Date().toISOString(),
    cashBalances: [
      {
        currency: account.baseCurrency || IBKR_DEFAULT_BASE_CURRENCY,
        currencySymbol: account.baseCurrency === IBKR_DEFAULT_BASE_CURRENCY ? '$' : undefined,
        amount: summaryTotals.totalCashValue,
        conversionRate: account.baseCurrency === IBKR_DEFAULT_BASE_CURRENCY ? 1 : undefined,
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
