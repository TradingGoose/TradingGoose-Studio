import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'
import { resolveAlpacaTradingBaseUrl } from '@/providers/trading/alpaca/config'
import { ALPACA_DEFAULT_BASE_CURRENCY } from '@/providers/trading/alpaca/positions'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioBaseContext,
  UnifiedTradingAccountStatus,
  UnifiedTradingAccountType,
} from '@/providers/trading/types'

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

export const mapAlpacaAccountType = (account: any): UnifiedTradingAccountType => {
  const multiplier = toFiniteNumber(account?.multiplier)
  const maxMarginMultiplier = toFiniteNumber(account?.admin_configurations?.max_margin_multiplier)

  if (
    (typeof multiplier === 'number' && multiplier > 1) ||
    (typeof maxMarginMultiplier === 'number' && maxMarginMultiplier > 1) ||
    account?.shorting_enabled === true
  ) {
    return 'margin'
  }

  if (
    multiplier === 1 ||
    maxMarginMultiplier === 1 ||
    account?.admin_configurations?.disable_shorting === true
  ) {
    return 'cash'
  }

  return 'unknown'
}

export const normalizeAlpacaTradingAccount = (
  account: any,
  context: Pick<TradingPortfolioBaseContext, 'credentialId' | 'serviceId' | 'providerId'>
): PortfolioIdentity => {
  const id = typeof account?.id === 'string' ? account.id.trim() : ''
  if (!id) {
    throw new Error('Alpaca account response missing account id')
  }

  const accountNumber =
    typeof account?.account_number === 'string' && account.account_number.trim()
      ? account.account_number.trim()
      : id

  return {
    providerId: context.providerId,
    credentialId: context.credentialId,
    serviceId: context.serviceId,
    accountId: id,
    providerName: 'Alpaca',
    accountName: `Alpaca (${accountNumber})`,
    accountType: mapAlpacaAccountType(account),
    baseCurrency:
      typeof account?.currency === 'string' && account.currency.trim()
        ? account.currency.trim().toUpperCase()
        : ALPACA_DEFAULT_BASE_CURRENCY,
    accountStatus: mapAlpacaAccountStatus(account?.status),
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
): Promise<PortfolioIdentity[]> {
  const account = await fetchAlpacaTradingAccount(context)
  return [normalizeAlpacaTradingAccount(account, context)]
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
