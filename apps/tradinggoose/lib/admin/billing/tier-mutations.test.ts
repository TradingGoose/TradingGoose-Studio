import { describe, expect, it } from 'vitest'
import { type AdminBillingTierMutationInput, validateAdminBillingTierInput } from './tier-mutations'

function createTierInput(
  overrides: Partial<AdminBillingTierMutationInput> = {}
): AdminBillingTierMutationInput {
  return {
    displayName: 'Free',
    description: 'Default free tier',
    status: 'draft',
    ownerType: 'user',
    usageScope: 'individual',
    seatMode: 'fixed',
    monthlyPriceUsd: null,
    yearlyPriceUsd: null,
    includedUsageLimitUsd: null,
    storageLimitGb: null,
    concurrencyLimit: null,
    seatCount: null,
    seatMaximum: null,
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    stripeProductId: null,
    syncRateLimitPerMinute: null,
    asyncRateLimitPerMinute: null,
    apiEndpointRateLimitPerMinute: null,
    canEditUsageLimit: false,
    canConfigureSso: false,
    logRetentionDays: null,
    workflowModelCostMultiplier: 1,
    functionExecutionDurationMultiplier: 0,
    copilotCostMultiplier: 1,
    pricingFeatures: [],
    isPublic: true,
    isDefault: true,
    displayOrder: 0,
    ...overrides,
  }
}

describe('validateAdminBillingTierInput', () => {
  it('allows a default tier to stay in draft while it is being edited', () => {
    expect(validateAdminBillingTierInput(createTierInput())).toBeNull()
  })

  it('still requires default tiers to stay public', () => {
    expect(validateAdminBillingTierInput(createTierInput({ isPublic: false }))).toBe(
      'The default tier must be visible in the public catalog'
    )
  })
})
