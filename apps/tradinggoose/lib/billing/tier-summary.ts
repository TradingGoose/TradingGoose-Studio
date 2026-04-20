import type { BillingTierSummary } from '@/lib/billing/types'

export const EMPTY_BILLING_TIER_SUMMARY: BillingTierSummary = {
  id: null,
  displayName: 'Billing tier',
  ownerType: 'user',
  usageScope: 'individual',
  seatMode: 'fixed',
  displayOrder: 0,
  monthlyPriceUsd: null,
  yearlyPriceUsd: null,
  includedUsageLimitUsd: null,
  storageLimitGb: null,
  concurrencyLimit: null,
  seatCount: null,
  seatMaximum: null,
  syncRateLimitPerMinute: null,
  asyncRateLimitPerMinute: null,
  apiEndpointRateLimitPerMinute: null,
  maxPendingAgeSeconds: null,
  maxPendingCount: null,
  canEditUsageLimit: false,
  canConfigureSso: false,
  logRetentionDays: null,
  workflowExecutionMultiplier: 1,
  workflowModelCostMultiplier: 1,
  functionExecutionMultiplier: 1,
  copilotCostMultiplier: 1,
  pricingFeatures: [],
  isPublic: false,
  hasStripeMonthlyPriceId: false,
}

type BillingTierAccessLike = {
  canEditUsageLimit?: boolean | null
  canConfigureSso?: boolean | null
  logRetentionDays?: number | null
}

export function canTierEditUsageLimit(
  tier: BillingTierAccessLike | null | undefined,
): boolean {
  return tier?.canEditUsageLimit ?? false
}

export function canTierConfigureSso(
  tier: BillingTierAccessLike | null | undefined,
): boolean {
  return tier?.canConfigureSso ?? false
}

export function getTierLogRetentionDays(
  tier: BillingTierAccessLike | null | undefined,
): number | null {
  return tier?.logRetentionDays ?? null
}
