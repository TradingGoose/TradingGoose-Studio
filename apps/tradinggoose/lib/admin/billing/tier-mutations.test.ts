import { describe, expect, it } from 'vitest'
import {
  type AdminBillingTierMutationInput,
  validateAdminBillingTierInput,
} from './tier-mutations'

function createTierInput(
  overrides: Partial<AdminBillingTierMutationInput> = {},
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
    includedUsageLimitUsd: 0,
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

  it('requires every tier to configure an included usage limit', () => {
    expect(
      validateAdminBillingTierInput(createTierInput({ includedUsageLimitUsd: null })),
    ).toBe('Billing tiers must configure an included usage limit')
  })

  it('allows a zero-price default tier to configure normal tier limits', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          status: 'active',
          includedUsageLimitUsd: 25,
          storageLimitGb: 10,
          concurrencyLimit: 3,
          syncRateLimitPerMinute: 30,
          asyncRateLimitPerMinute: 15,
          apiEndpointRateLimitPerMinute: 30,
          canEditUsageLimit: true,
        }),
      ),
    ).toBeNull()
  })

  it('still requires default tiers to stay public', () => {
    expect(
      validateAdminBillingTierInput(createTierInput({ isPublic: false })),
    ).toBe('The default tier must be visible in the public catalog')
  })

  it('requires a Stripe monthly price ID when creating a new tier', () => {
    expect(
      validateAdminBillingTierInput(createTierInput(), {
        requireStripeMonthlyPriceId: true,
      }),
    ).toBe('New tiers must configure a Stripe monthly price ID')
  })

  it('accepts new tiers when the Stripe monthly price ID is configured', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({ stripeMonthlyPriceId: 'price_monthly' }),
        {
          requireStripeMonthlyPriceId: true,
        },
      ),
    ).toBeNull()
  })

  it('accepts a default zero-recurring tier when a Stripe monthly price ID is configured', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          status: 'active',
          includedUsageLimitUsd: 25,
          storageLimitGb: 10,
          concurrencyLimit: 3,
          syncRateLimitPerMinute: 30,
          asyncRateLimitPerMinute: 15,
          apiEndpointRateLimitPerMinute: 30,
          stripeMonthlyPriceId: 'price_monthly',
        }),
        {
          requireStripeMonthlyPriceId: true,
        },
      ),
    ).toBeNull()
  })
})
