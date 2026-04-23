import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'
import { ALPACA_DEFAULT_BASE_CURRENCY } from '@/providers/trading/alpaca/positions'
import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioBaseContext,
  UnifiedTradingAccount,
  UnifiedTradingAccountStatus,
} from '@/providers/trading/types'

export const resolveAlpacaTradingBaseUrl = (environment?: 'paper' | 'live') =>
  environment === 'paper' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

export const mapAlpacaAccountStatus = (value: unknown): UnifiedTradingAccountStatus => {
  if (typeof value !== 'string') return 'unknown'

  switch (value.trim().toUpperCase()) {
    case 'ACTIVE':
    case 'APPROVED':
      return 'active'
    case 'ACCOUNT_CLOSED':
    case 'REJECTED':
    case 'SUBMISSION_FAILED':
      return 'closed'
    case 'ACCOUNT_UPDATED':
    case 'APPROVAL_PENDING':
    case 'ACTION_REQUIRED':
    case 'ONBOARDING':
    case 'SUBMITTED':
    case 'INACTIVE':
      return 'restricted'
    default:
      return 'unknown'
  }
}

export const normalizeAlpacaTradingAccount = (
  account: any,
  environment?: 'paper' | 'live'
): UnifiedTradingAccount => {
  const id = typeof account?.id === 'string' ? account.id.trim() : ''
  if (!id) {
    throw new Error('Alpaca account response missing account id')
  }

  const accountNumber =
    typeof account?.account_number === 'string' && account.account_number.trim()
      ? account.account_number.trim()
      : id

  return {
    id,
    name: `Alpaca ${environment === 'paper' ? 'Paper' : 'Live'} (${accountNumber})`,
    type: environment === 'paper' ? 'paper' : 'unknown',
    baseCurrency:
      typeof account?.currency === 'string' && account.currency.trim()
        ? account.currency.trim().toUpperCase()
        : ALPACA_DEFAULT_BASE_CURRENCY,
    status: mapAlpacaAccountStatus(account?.status),
  }
}

export async function fetchAlpacaTradingAccount(context: TradingPortfolioBaseContext) {
  const baseUrl = resolveAlpacaTradingBaseUrl(context.environment)
  return fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/v2/account`,
    init: {
      method: 'GET',
      headers: buildAlpacaAuthHeaders({ accessToken: context.accessToken }),
    },
  })
}

export async function getAlpacaTradingAccounts(
  context: TradingPortfolioBaseContext
): Promise<UnifiedTradingAccount[]> {
  const account = await fetchAlpacaTradingAccount(context)
  return [normalizeAlpacaTradingAccount(account, context.environment)]
}

export const normalizeAlpacaSnapshotAccountSummary = (account: any) => {
  const totalCashValue = toFiniteNumber(account?.cash ?? 0) ?? 0
  const equity = toFiniteNumber(account?.equity ?? account?.portfolio_value ?? 0) ?? 0
  const totalPortfolioValue = toFiniteNumber(account?.portfolio_value ?? account?.equity ?? 0) ?? 0
  const buyingPower = toFiniteNumber(account?.buying_power ?? 0) ?? 0

  return {
    totalCashValue,
    totalPortfolioValue,
    equity,
    buyingPower,
  }
}
