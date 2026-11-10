import type { BillingTierSummary } from '@/lib/billing/types'

export type { BillingTierSummary } from '@/lib/billing/types'

export interface UsageData {
  current: string | null
  limit?: string | null
  percentUsed?: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: string | null
  lastPeriodCopilotCost?: string | null
  copilotCost?: string | null
}

export interface UsageLimitData {
  currentLimit: string | null
  canEdit: boolean
  minimumLimit: string
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
  hasPaymentMethodOnFile?: boolean
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
