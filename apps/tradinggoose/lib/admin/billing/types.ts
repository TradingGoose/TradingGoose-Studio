export interface AdminBillingTierSnapshot {
  id: string
  displayName: string
  description: string
  status: 'active' | 'draft' | 'archived'
  ownerType: 'user' | 'organization'
  usageScope: 'individual' | 'pooled'
  seatMode: 'fixed' | 'adjustable'
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
  includedUsageLimitUsd: number | null
  storageLimitGb: number | null
  concurrencyLimit: number | null
  seatCount: number | null
  seatMaximum: number | null
  stripeMonthlyPriceId: string | null
  stripeYearlyPriceId: string | null
  stripeProductId: string | null
  syncRateLimitPerMinute: number | null
  asyncRateLimitPerMinute: number | null
  apiEndpointRateLimitPerMinute: number | null
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: number | null
  workflowModelCostMultiplier: number | null
  functionExecutionDurationMultiplier: number | null
  copilotCostMultiplier: number | null
  pricingFeatures: string[]
  isPublic: boolean
  isDefault: boolean
  displayOrder: number
  subscriptionCount: number
}

export interface AdminBillingSnapshot {
  billingEnabled: boolean
  onboardingAllowanceUsd: string
  overageThresholdDollars: string
  workflowExecutionChargeUsd: string
  functionExecutionChargeUsd: string
  usageWarningThresholdPercent: number
  freeTierUpgradeThresholdPercent: number
  enterpriseContactUrl: string | null
  currentTiers: AdminBillingTierSnapshot[]
}
