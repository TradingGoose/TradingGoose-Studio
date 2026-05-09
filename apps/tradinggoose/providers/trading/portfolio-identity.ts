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
  const credentialServiceId = readText(record, 'credentialServiceId')
  const accountId = readText(record, 'accountId')

  if (!providerId || !credentialServiceId || !accountId) {
    return null
  }

  return {
    providerId: providerId as TradingProviderId,
    credentialServiceId,
    accountId,
    providerName: readText(record, 'providerName') ?? null,
    accountName: readText(record, 'accountName') ?? null,
    accountType: (readText(record, 'accountType') as UnifiedTradingAccountType) ?? null,
    baseCurrency: readText(record, 'baseCurrency') ?? null,
    accountStatus: (readText(record, 'accountStatus') as UnifiedTradingAccountStatus) ?? null,
  }
}

export const getPortfolioIdentityKey = (portfolio: PortfolioIdentity) =>
  `${portfolio.providerId}|${portfolio.credentialServiceId}|${portfolio.accountId}`

export const arePortfolioIdentitiesEqual = (
  left?: PortfolioIdentity | null,
  right?: PortfolioIdentity | null
) => {
  if (!left || !right) return false
  return getPortfolioIdentityKey(left) === getPortfolioIdentityKey(right)
}
