import type { DecimalAmount } from '@tradinggoose/billing/money'

export interface AdminBillingTierSnapshot {
  id: string
  displayName: string
  description: string
  accessCode: string | null
  status: 'active' | 'draft' | 'archived'
  ownerType: 'user' | 'organization'
  usageScope: 'individual' | 'pooled'
  seatMode: 'fixed' | 'adjustable'
  monthlyPriceUsd: DecimalAmount | null
  yearlyPriceUsd: DecimalAmount | null
  includedUsageLimitUsd: DecimalAmount | null
  storageLimitGb: number | null
  concurrencyLimit: number | null
  workflowExecutionTimeLimitSeconds: number | null
  seatCount: number | null
  seatMaximum: number | null
  stripeMonthlyPriceId: string | null
  stripeYearlyPriceId: string | null
  stripeProductId: string | null
  syncRateLimitPerMinute: number | null
  asyncRateLimitPerMinute: number | null
  apiEndpointRateLimitPerMinute: number | null
  maxPendingAgeSeconds: number | null
  maxPendingCount: number | null
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: number | null
  workflowExecutionMultiplier: DecimalAmount | null
  workflowModelCostMultiplier: DecimalAmount | null
  functionExecutionMultiplier: DecimalAmount | null
  copilotCostMultiplier: DecimalAmount | null
  pricingFeatures: string[]
  isPublic: boolean
  isDefault: boolean
  displayOrder: number
  subscriptionCount: number
}

export interface AdminBillingSnapshot {
  billingEnabled: boolean
  onboardingAllowanceUsd: DecimalAmount
  overageThresholdDollars: DecimalAmount
  workflowExecutionChargeUsd: DecimalAmount
  functionExecutionChargeUsd: DecimalAmount
  usageWarningThresholdPercent: number
  freeTierUpgradeThresholdPercent: number
  enterpriseContactUrl: string | null
  currentTiers: AdminBillingTierSnapshot[]
}
