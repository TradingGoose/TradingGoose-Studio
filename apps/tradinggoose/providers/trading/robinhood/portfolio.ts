import { z } from 'zod'
import { buildPortfolioDetail } from '@/providers/trading/portfolio-detail'
import {
  getPortfolioAccountLabel,
  type PortfolioIdentity,
} from '@/providers/trading/portfolio-identity'
import { robinhoodNumber, withRobinhoodTradingClient } from '@/providers/trading/robinhood/client'
import { robinhoodTradingProviderConfig } from '@/providers/trading/robinhood/config'
import type {
  TradingPortfolioAccountContext,
  TradingPortfolioBaseContext,
  UnifiedTradingPosition,
} from '@/providers/trading/types'
import { tradingSymbolToListingIdentity } from '@/providers/trading/utils'

// Live-verified shapes: ssherman/robinhood-wizard, design notes "Phase 1 read shapes".
const accountsSchema = z.object({
  accounts: z
    .array(
      z.object({
        account_number: z.string().trim().min(1),
        agentic_allowed: z.boolean(),
        type: z.string(),
        nickname: z.string().nullish(),
      })
    )
    .nullable()
    .transform((accounts) => accounts ?? []),
})
const portfolioSchema = z.object({
  total_value: robinhoodNumber,
  equity_value: robinhoodNumber,
  cash: robinhoodNumber,
  currency: z.literal('USD'),
  buying_power: z.object({ buying_power: robinhoodNumber }).nullable(),
})
const positionsSchema = z.object({
  positions: z
    .array(
      z.object({
        symbol: z.string().trim().min(1),
        quantity: robinhoodNumber,
        average_buy_price: robinhoodNumber.nullish(),
      })
    )
    .nullable()
    .transform((positions) => positions ?? []),
  next: z.string().nullish(),
})

export async function getRobinhoodTradingAccounts(
  context: TradingPortfolioBaseContext
): Promise<PortfolioIdentity[]> {
  return withRobinhoodTradingClient(context.accessToken, async (call) => {
    const { accounts } = accountsSchema.parse(await call('get_accounts', {}))
    return accounts
      .filter((account) => account.agentic_allowed)
      .map((account) => ({
        providerId: 'robinhood',
        credentialId: context.credentialId,
        serviceId: context.serviceId,
        accountId: account.account_number,
        providerName: 'Robinhood',
        accountName: getPortfolioAccountLabel({
          providerId: 'robinhood',
          accountId: account.account_number,
          accountName: account.nickname,
        }),
        accountType:
          account.type === 'cash' || account.type === 'margin' ? account.type : 'unknown',
        baseCurrency: 'USD',
      }))
  })
}

export async function getRobinhoodTradingAccountSnapshot(context: TradingPortfolioAccountContext) {
  const { portfolio, positions } = await withRobinhoodTradingClient(
    context.accessToken,
    async (call) => {
      const args = { account_number: context.accountId }
      const portfolio = portfolioSchema.parse(await call('get_portfolio', args))
      const positions: UnifiedTradingPosition[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = positionsSchema.parse(
          await call('get_equity_positions', { ...args, ...(cursor ? { cursor } : {}) })
        )
        positions.push(
          ...page.positions.map(
            (position): UnifiedTradingPosition => ({
              listingIdentity:
                tradingSymbolToListingIdentity(robinhoodTradingProviderConfig, {
                  symbol: position.symbol,
                })?.listing ?? null,
              quantity: position.quantity,
              side: position.quantity > 0 ? 'long' : position.quantity < 0 ? 'short' : 'flat',
              averagePrice: position.average_buy_price ?? undefined,
              costBasis:
                position.average_buy_price == null
                  ? undefined
                  : position.quantity * position.average_buy_price,
              currencySymbol: '$',
            })
          )
        )
        cursor = page.next
          ? (new URL(page.next).searchParams.get('cursor') ?? undefined)
          : undefined
        if (page.next && (!cursor || cursors.has(cursor) || cursors.size >= 100)) {
          throw new Error('Robinhood returned invalid positions pagination.')
        }
        if (cursor) cursors.add(cursor)
      } while (cursor)
      return { portfolio, positions }
    }
  )
  return buildPortfolioDetail({
    identity: {
      providerId: 'robinhood',
      credentialId: context.credentialId,
      serviceId: context.serviceId,
      accountId: context.accountId,
      providerName: 'Robinhood',
      accountName: getPortfolioAccountLabel(context),
      baseCurrency: 'USD',
    },
    environment: 'live',
    asOf: new Date().toISOString(),
    cashBalances: [{ currency: 'USD', currencySymbol: '$', amount: portfolio.cash }],
    positions,
    summary: {
      totalPortfolioValue: portfolio.total_value,
      totalCashValue: portfolio.cash,
      totalHoldingsValue: portfolio.equity_value,
      buyingPower: portfolio.buying_power?.buying_power,
      equity: portfolio.total_value,
    },
  })
}
