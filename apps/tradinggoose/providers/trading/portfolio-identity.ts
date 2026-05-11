import type {
  TradingProviderId,
  UnifiedTradingAccountStatus,
  UnifiedTradingAccountSummary,
  UnifiedTradingAccountType,
  UnifiedTradingCashBalance,
  UnifiedTradingOrder,
  UnifiedTradingPosition,
} from '@/providers/trading/types'

export type PortfolioEnvironment = 'live' | 'paper'

export type PortfolioIdentity = {
  providerId: TradingProviderId
  credentialId: string
  credentialServiceId: string
  accountId: string
  providerName?: string | null
  accountName?: string | null
  accountType?: UnifiedTradingAccountType | null
  baseCurrency?: string | null
  accountStatus?: UnifiedTradingAccountStatus | null
}

export type PortfolioDetail = PortfolioIdentity & {
  environment: PortfolioEnvironment
  asOf: string
  cashBalances: UnifiedTradingCashBalance[]
  positions: UnifiedTradingPosition[]
  orders: UnifiedTradingOrder[]
  summary: UnifiedTradingAccountSummary
}

const readText = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed) return trimmed
  return undefined
}

export const toPortfolioValueObject = (value: unknown): PortfolioIdentity | null => {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const providerId = readText(record, 'providerId')
  const credentialId = readText(record, 'credentialId')
  const credentialServiceId = readText(record, 'credentialServiceId')
  const accountId = readText(record, 'accountId')

  if (!providerId || !credentialId || !credentialServiceId || !accountId) {
    return null
  }

  const identity: PortfolioIdentity = {
    providerId: providerId as TradingProviderId,
    credentialId,
    credentialServiceId,
    accountId,
  }

  const providerName = readText(record, 'providerName')
  const accountName = readText(record, 'accountName')
  const accountType = readText(record, 'accountType') as UnifiedTradingAccountType | undefined
  const baseCurrency = readText(record, 'baseCurrency')
  const accountStatus = readText(record, 'accountStatus') as UnifiedTradingAccountStatus | undefined

  if (providerName) identity.providerName = providerName
  if (accountName) identity.accountName = accountName
  if (accountType) identity.accountType = accountType
  if (baseCurrency) identity.baseCurrency = baseCurrency
  if (accountStatus) identity.accountStatus = accountStatus

  return identity
}

export const getPortfolioIdentityKey = (portfolio: PortfolioIdentity) =>
  `${portfolio.providerId}|${portfolio.credentialId}|${portfolio.accountId}`

export const arePortfolioIdentitiesEqual = (
  left?: PortfolioIdentity | null,
  right?: PortfolioIdentity | null
) => {
  if (!left || !right) return false
  return getPortfolioIdentityKey(left) === getPortfolioIdentityKey(right)
}
