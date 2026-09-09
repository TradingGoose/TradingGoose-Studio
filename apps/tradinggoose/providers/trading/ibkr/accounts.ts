import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrApiUrl } from '@/providers/trading/ibkr/client'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { fetchBrokerJson, toFiniteNumber } from '@/providers/trading/portfolio-utils'
import type {
  TradingPortfolioBaseContext,
  UnifiedTradingAccountStatus,
  UnifiedTradingAccountType,
} from '@/providers/trading/types'

interface IbkrAccountsResponse {
  accounts?: Array<{
    id?: string
    accountId?: string
    accountTitle?: string
    accountType?: string
    currency?: string
    status?: string
  }>
}

export const mapIbkrAccountStatus = (value: unknown): UnifiedTradingAccountStatus => {
  if (typeof value !== 'string') return 'unknown'

  switch (value.trim().toUpperCase()) {
    case 'ACTIVE':
    case 'PASSED':
      return 'active'
    case 'CLOSED':
    case 'PENDING_CLOSE':
      return 'closed'
    case 'NEW':
    case 'PENDING':
    case 'VERIFICATION_REQUIRED':
    case 'DISABLED':
    case 'INACTIVE':
    case 'RESTRICTED':
      return 'restricted'
    default:
      return 'unknown'
  }
}

export const mapIbkrAccountType = (value: unknown): UnifiedTradingAccountType => {
  if (typeof value !== 'string') return 'unknown'

  switch (value.trim().toLowerCase()) {
    case 'cash':
      return 'cash'
    case 'margin':
      return 'margin'
    case 'portfolio':
      return 'portfolio'
    case 'individual':
    case 'joint':
    case 'ira':
    case 'trust':
    case 'llc':
      return 'margin'
    case 'advisor':
      return 'portfolio'
    default:
      return 'unknown'
  }
}

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const normalizeIbkrTradingAccount = (
  account: any,
  context: Pick<TradingPortfolioBaseContext, 'credentialId' | 'serviceId' | 'providerId'>
): PortfolioIdentity => {
  const id = readText(account?.id) || readText(account?.accountId)
  if (!id) {
    throw new Error('IBKR accounts response missing account id')
  }

  const rawType = readText(account?.accountType)
  const accountType = mapIbkrAccountType(rawType)
  const leverage = toFiniteNumber(account?.leverage)
  const type = typeof leverage === 'number' && leverage > 1 ? 'margin' : accountType

  return {
    providerId: context.providerId,
    credentialId: context.credentialId,
    serviceId: context.serviceId,
    accountId: id,
    providerName: 'IBKR',
    accountName: readText(account?.accountTitle) || `IBKR (${id})`,
    accountType: type,
    baseCurrency: readText(account?.currency)?.toUpperCase() ?? 'USD',
    accountStatus: mapIbkrAccountStatus(readText(account?.status)),
  }
}

export async function getIbkrTradingAccounts(
  context: TradingPortfolioBaseContext
): Promise<PortfolioIdentity[]> {
  const response = await fetchBrokerJson<IbkrAccountsResponse>({
    providerId: context.providerId,
    url: buildIbkrApiUrl('/iserver/accounts'),
    init: {
      method: 'GET',
      headers: buildIbkrAuthHeaders({ accessToken: context.accessToken }),
    },
  })

  const accounts = Array.isArray(response?.accounts) ? response.accounts : []
  const identities = accounts.map((account) => normalizeIbkrTradingAccount(account, context))
  if (identities.length === 0) {
    throw new Error('No IBKR accounts returned for the connected session')
  }
  return identities
}
