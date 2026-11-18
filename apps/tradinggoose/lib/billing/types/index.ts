/**
 * Billing System Types
 * Centralized type definitions for the billing system
 */

export interface EnterpriseSubscriptionMetadata {
  // Enterprise subscriptions are organization-owned and store an explicit billing subject.
  referenceType: 'organization'
  referenceId: string
  // Hidden organization tier to map the contract subscription onto
  billingTierId: string
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
  status: 'active' | 'draft' | 'archived' | null
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
  workflowExecutionMultiplier: number
  workflowModelCostMultiplier: number
  functionExecutionMultiplier: number
  copilotCostMultiplier: number
  pricingFeatures: string[]
  isPublic: boolean
  hasStripeMonthlyPriceId: boolean
}
