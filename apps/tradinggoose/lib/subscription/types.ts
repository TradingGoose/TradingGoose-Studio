import type { BillingTierSummary } from '@/lib/billing/types'

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

export interface SubscriptionData {
  isPaid: boolean
  status: string | null
  seats: number | null
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
  tier: BillingTierSummary
}
