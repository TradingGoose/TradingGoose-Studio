/**
 * Billing System Types
 * Centralized type definitions for the billing system
 */

export interface EnterpriseSubscriptionMetadata {
  // Enterprise subscriptions are organization-owned and store an explicit billing subject.
  referenceType: 'organization'
  referenceId: string
  // Hidden organization tier to map the contract subscription onto
  billingTierId?: string
  // The fixed monthly price for this enterprise customer (as string from Stripe metadata)
  // This will be used to set the organization's usage limit
  monthlyPrice: string
  // Number of seats for invitation limits (not for billing) (as string from Stripe metadata)
  // We set Stripe quantity to 1 and use this for actual seat count
  seats: string
}

export interface UsageData {
  currentUsage: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}

export interface UsageLimitInfo {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  tier: BillingTierSummary
  updatedAt: Date | null
}

export interface BillingTierSummary {
  id: string | null
  displayName: string
  ownerType: 'user' | 'organization'
  usageScope: 'individual' | 'pooled'
  seatMode: 'fixed' | 'adjustable'
  displayOrder: number
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
  includedUsageLimitUsd: number | null
  storageLimitGb: number | null
  concurrencyLimit: number | null
  seatCount: number | null
  seatMaximum: number | null
  syncRateLimitPerMinute: number | null
  asyncRateLimitPerMinute: number | null
  apiEndpointRateLimitPerMinute: number | null
  maxPendingAgeSeconds: number | null
  maxPendingCount: number | null
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: number | null
  workflowModelCostMultiplier: number
  functionExecutionDurationMultiplier: number
  copilotCostMultiplier: number
  pricingFeatures: string[]
  isPublic: boolean
  hasStripeMonthlyPriceId: boolean
}

export interface BillingData {
  currentPeriodCost: number
  projectedCost: number
  limit: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  daysRemaining: number
}

export interface UserSubscriptionState {
  tier: BillingTierSummary
  effectiveSubscription: any | null
  hasExceededLimit: boolean
}

export interface BillingEntity {
  id: string
  type: 'user' | 'organization'
  referenceId: string
  metadata?: { stripeCustomerId?: string; [key: string]: any } | null
  createdAt: Date
  updatedAt: Date
}

export interface BillingConfig {
  id: string
  entityType: 'user' | 'organization'
  entityId: string
  usageLimit: number
  limitSetBy?: string
  limitUpdatedAt?: Date
  billingPeriodType: 'monthly' | 'annual'
  autoResetEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface UsagePeriod {
  id: string
  entityType: 'user' | 'organization'
  entityId: string
  periodStart: Date
  periodEnd: Date
  totalCost: number
  finalCost?: number
  isCurrent: boolean
  status: 'active' | 'finalized' | 'billed'
  createdAt: Date
  finalizedAt?: Date
}

export interface BillingStatus {
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}

export interface TeamUsageLimit {
  userId: string
  userName: string
  userEmail: string
  currentLimit: number
  currentUsage: number
  totalCost: number
  lastActive: Date | null
  limitSetBy: string | null
  limitUpdatedAt: Date | null
}

export interface BillingSummary {
  userId: string
  email: string
  name: string
  currentPeriodCost: number
  currentUsageLimit: number
  currentUsagePercentage: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  tier: BillingTierSummary
  subscriptionStatus: string | null
  seats: number | null
  billingStatus: 'ok' | 'warning' | 'exceeded'
}

export interface SubscriptionAPIResponse {
  isPaid: boolean
  status: string | null
  seats: number | null
  metadata: any | null
  tier: BillingTierSummary
  usage: UsageData
}

export interface UsageLimitAPIResponse {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  tier: BillingTierSummary
  setBy?: string
  updatedAt?: Date
}

// Utility Types
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'unpaid'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
export type BillingEntityType = 'user' | 'organization'
export type BillingPeriodType = 'monthly' | 'annual'
export type UsagePeriodStatus = 'active' | 'finalized' | 'billed'
export type BillingStatusType = 'ok' | 'warning' | 'exceeded'

// Error Types
export interface BillingError {
  code: string
  message: string
  details?: any
}

export interface UpdateUsageLimitResult {
  success: boolean
  error?: string
}

// Hook Types for React
export interface UseSubscriptionStateReturn {
  subscription: {
    isPaid: boolean
    status?: string
    seats?: number
    metadata?: any
    tier: BillingTierSummary
  }
  usage: UsageData
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<any>
  canUpgrade: () => boolean
  getBillingStatus: () => BillingStatusType
  getRemainingBudget: () => number
  getDaysRemainingInPeriod: () => number | null
}

export interface UseUsageLimitReturn {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  tier: BillingTierSummary
  setBy?: string
  updatedAt?: Date
  updateLimit: (newLimit: number) => Promise<{ success: boolean }>
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<any>
}
