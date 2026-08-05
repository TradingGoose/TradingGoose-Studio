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
    accessCode: null,
    workflowExecutionTimeLimitSeconds: null,
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
  it('requires the complete tier payload and accepts only positive integer execution seconds', () => {
    const payload = createTierInput()
    expect(adminBillingTierMutationSchema.safeParse(payload).success).toBe(true)
    expect(
      adminBillingTierMutationSchema.safeParse({
        ...payload,
        workflowExecutionTimeLimitSeconds: 30,
      }).success
    ).toBe(true)
    expect(
      adminBillingTierMutationSchema.safeParse({
        ...payload,
        workflowExecutionTimeLimitSeconds: 1.5,
      }).success
    ).toBe(false)
    expect(
      adminBillingTierMutationSchema.safeParse({
        ...payload,
        workflowExecutionTimeLimitSeconds: 0,
      }).success
    ).toBe(false)
    const { maxPendingCount: _missing, ...incomplete } = payload
    expect(adminBillingTierMutationSchema.safeParse(incomplete).success).toBe(false)
  })

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

  it('rejects access codes on public tiers before persistence normalization', () => {
    expect(validateAdminBillingTierInput(createTierInput({ accessCode: 'Alpha' }))).toBe(
      'Public tiers cannot configure an access code'
    )
  })

  it('requires a Stripe monthly price ID for a recurring monthly tier', () => {
    expect(
      validateAdminBillingTierInput(createTierInput({ isDefault: false, monthlyPriceUsd: 10 }))
    ).toBe('Tiers with a recurring monthly price must configure a Stripe monthly price ID')
  })

  it('accepts a recurring monthly tier when the Stripe monthly price ID is configured', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          isDefault: false,
          monthlyPriceUsd: 10,
          stripeMonthlyPriceId: 'price_monthly',
        })
      )
    ).toBeNull()
  })

  it('allows a zero-recurring default tier without a Stripe price ID', () => {
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
        })
      )
    ).toBeNull()
  })
})
