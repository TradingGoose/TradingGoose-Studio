import { describe, expect, it } from 'vitest'
import {
  type AdminBillingTierMutationInput,
  adminBillingTierMutationSchema,
  validateAdminBillingTierInput,
} from './tier-mutations'

function createTierInput(
  overrides: Partial<AdminBillingTierMutationInput> = {}
): AdminBillingTierMutationInput {
  return {
    displayName: 'Free',
    description: 'Default free tier',
    accessCode: null,
    status: 'draft',
    ownerType: 'user',
    usageScope: 'individual',
    seatMode: 'fixed',
    monthlyPriceUsd: null,
    yearlyPriceUsd: null,
    includedUsageLimitUsd: 0,
    storageLimitGb: null,
    concurrencyLimit: null,
    workflowExecutionTimeLimitSeconds: null,
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
    expect(validateAdminBillingTierInput(createTierInput({ includedUsageLimitUsd: null }))).toBe(
      'Billing tiers must configure an included usage limit'
    )
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
        })
      )
    ).toBeNull()
  })

  it('still requires default tiers to stay public', () => {
    expect(validateAdminBillingTierInput(createTierInput({ isPublic: false }))).toBe(
      'The default tier must be visible in the public catalog'
    )
  })

  it('requires a Stripe monthly price ID when creating a new tier', () => {
    expect(
      validateAdminBillingTierInput(createTierInput(), {
        requireStripeMonthlyPriceId: true,
      })
    ).toBe('New tiers must configure a Stripe monthly price ID')
  })

  it('accepts new tiers when the Stripe monthly price ID is configured', () => {
    expect(
      validateAdminBillingTierInput(createTierInput({ stripeMonthlyPriceId: 'price_monthly' }), {
        requireStripeMonthlyPriceId: true,
      })
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
        }
      )
    ).toBeNull()
  })

  it('only allows access codes on private Stripe-backed tiers', () => {
    expect(validateAdminBillingTierInput(createTierInput({ accessCode: 'invite' }))).toBe(
      'Public tiers cannot configure a private access code'
    )

    expect(
      validateAdminBillingTierInput(
        createTierInput({
          accessCode: 'invite',
          isDefault: false,
          isPublic: false,
        })
      )
    ).toBe('Private tiers with an access code must configure a Stripe monthly price ID')
  })

  it('allows an existing non-Stripe enterprise placeholder to remain active', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          isDefault: false,
          isPublic: false,
          status: 'active',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatCount: 10,
          storageLimitGb: 10,
          concurrencyLimit: 3,
          syncRateLimitPerMinute: 30,
          asyncRateLimitPerMinute: 15,
          apiEndpointRateLimitPerMinute: 30,
        })
      )
    ).toBeNull()
  })

  it('requires private tier workflow execution time limits to be at least five seconds', () => {
    const privateTier = { isDefault: false, isPublic: false }

    expect(
      adminBillingTierMutationSchema.safeParse(
        createTierInput({
          ...privateTier,
          workflowExecutionTimeLimitSeconds: 4,
        })
      ).success
    ).toBe(false)
    expect(
      adminBillingTierMutationSchema.safeParse(
        createTierInput({
          ...privateTier,
          workflowExecutionTimeLimitSeconds: 5,
        })
      ).success
    ).toBe(true)
  })

  it('requires private access codes to be at least 16 characters', () => {
    expect(
      adminBillingTierMutationSchema.safeParse(createTierInput({ accessCode: 'short-code' })).success
    ).toBe(false)
  })
})
