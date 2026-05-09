import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
import {
  mapTradierAccountType,
  TRADIER_DEFAULT_BASE_CURRENCY,
} from '@/providers/trading/tradier/positions'
import type {
  TradingPortfolioBaseContext,
  UnifiedTradingAccountStatus,
} from '@/providers/trading/types'

export const mapTradierAccountStatus = (value: unknown): UnifiedTradingAccountStatus => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'active') return 'active'
  if (normalized === 'closed') return 'closed'
  return 'unknown'
}

const toTradierAccountsArray = (profileResponse: any) => {
  const accounts = profileResponse?.profile?.account ?? profileResponse?.account ?? []
  if (Array.isArray(accounts)) return accounts
  if (!accounts) return []
  return [accounts]
}

export const normalizeTradierTradingAccount = (
  account: any,
  context: Pick<TradingPortfolioBaseContext, 'credentialServiceId' | 'providerId'>
): PortfolioIdentity => {
  const accountNumber =
    typeof account?.account_number === 'string' ? account.account_number.trim() : ''
  if (!accountNumber) {
    throw new Error('Tradier profile response missing account number')
  }

  const classification =
    typeof account?.classification === 'string' ? account.classification.trim() : ''

  return {
    providerId: context.providerId,
    credentialServiceId: context.credentialServiceId ?? '',
    accountId: accountNumber,
    providerName: 'Tradier',
    accountName: classification ? `${classification} (${accountNumber})` : accountNumber,
    accountType: mapTradierAccountType(account?.type),
    baseCurrency: TRADIER_DEFAULT_BASE_CURRENCY,
    accountStatus: mapTradierAccountStatus(account?.status),
  }
}

export async function fetchTradierTradingProfile(context: TradingPortfolioBaseContext) {
  const baseUrl = resolveTradierBaseUrl()
  return fetchBrokerJson<any>({
    providerId: context.providerId,
    url: `${baseUrl}/user/profile`,
    init: {
      method: 'GET',
      headers: {
        ...buildTradierAuthHeaders({ accessToken: context.accessToken }),
        Accept: 'application/json',
      },
    },
  })
}

export async function getTradierTradingAccounts(
  context: TradingPortfolioBaseContext
): Promise<PortfolioIdentity[]> {
  const profile = await fetchTradierTradingProfile(context)
  return toTradierAccountsArray(profile).map((account) => normalizeTradierTradingAccount(account, context))
}
