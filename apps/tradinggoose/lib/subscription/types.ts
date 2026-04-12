import type { BillingTierSummary } from '@/lib/billing/types'

export type { BillingTierSummary } from '@/lib/billing/types'

export interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
  lastPeriodCopilotCost?: number
  copilotCost?: number
}

export interface UsageLimitData {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  setBy?: string
  updatedAt?: Date
}

export interface SubscriptionData {
  id?: string | null
  billingEnabled?: boolean
  isPaid: boolean
  status: string | null
  seats: number | null
  metadata: any | null
  stripeSubscriptionId: string | null
  periodEnd: Date | null
  cancelAtPeriodEnd?: boolean
  tier: BillingTierSummary
  usage: UsageData
  billingBlocked?: boolean
}

export type BillingStatus = 'unknown' | 'ok' | 'warning' | 'exceeded' | 'blocked'

export interface SubscriptionStatusData {
  isPaid: boolean
  isFree: boolean
  status: string | null
  seats: number | null
  metadata: any | null
  tier: BillingTierSummary
}

export interface SubscriptionStore {
  subscriptionData: SubscriptionData | null
  usageLimitData: UsageLimitData | null
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  loadSubscriptionData: () => Promise<SubscriptionData | null>
  loadUsageLimitData: () => Promise<UsageLimitData | null>
  loadData: () => Promise<{
    subscriptionData: SubscriptionData | null
    usageLimitData: UsageLimitData | null
  }>
  updateUsageLimit: (newLimit: number) => Promise<{ success: boolean; error?: string }>
  refresh: () => Promise<void>
  clearError: () => void
  reset: () => void
  getSubscriptionStatus: () => SubscriptionStatusData
  getUsage: () => UsageData
  getBillingStatus: () => BillingStatus
  getRemainingBudget: () => number
  getDaysRemainingInPeriod: () => number | null
  canUpgrade: () => boolean
}
