import { describe, expect, it } from 'vitest'
import {
  type AdminBillingTierMutationInput,
  adminBillingTierMutationSchema,
  toBillingTierMutationValues,
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
    includedUsageLimitUsd: '0',
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
    workflowExecutionMultiplier: '1',
    workflowModelCostMultiplier: '1',
    functionExecutionMultiplier: '1',
    copilotCostMultiplier: '1',
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
          includedUsageLimitUsd: '25',
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
      validateAdminBillingTierInput(
        createTierInput({
          stripeMonthlyPriceId: 'price_monthly',
        }),
        { requireStripeMonthlyPriceId: true }
      )
    ).toBeNull()
  })

  it('accepts a default zero-recurring tier when a Stripe monthly price ID is configured', () => {
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          status: 'active',
          includedUsageLimitUsd: '25',
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

  it('trims private access codes and treats blank as unconfigured', () => {
    expect(
      adminBillingTierMutationSchema.parse(createTierInput({ accessCode: ' invite ' })).accessCode
    ).toBe('invite')
    expect(
      adminBillingTierMutationSchema.parse(createTierInput({ accessCode: '   ' })).accessCode
    ).toBeNull()
    expect(
      adminBillingTierMutationSchema.safeParse(createTierInput({ accessCode: 'x' })).success
    ).toBe(true)
    expect(
      adminBillingTierMutationSchema.safeParse(createTierInput({ accessCode: 'x'.repeat(129) }))
        .success
    ).toBe(true)
  })

  it('keeps the Stripe product ID optional and requires distinct Stripe price IDs', () => {
    expect(
      validateAdminBillingTierInput(createTierInput({ stripeMonthlyPriceId: 'price_monthly' }))
    ).toBeNull()
    expect(
      validateAdminBillingTierInput(
        createTierInput({
          stripeMonthlyPriceId: 'price_same',
          stripeYearlyPriceId: 'price_same',
        })
      )
    ).toBe('Stripe monthly and yearly price IDs must be different')
  })
})

describe('exact admin tier money ingress', () => {
  it('preserves exact decimal values through JSON validation and database values', () => {
    const source = createTierInput({
      monthlyPriceUsd: '9007199254740993.30000000000000001',
      yearlyPriceUsd: '1.0000000000000000000000000000000001',
      includedUsageLimitUsd: '0.000000000000000000000000000001',
      workflowExecutionMultiplier: '0.30000000000000001',
      workflowModelCostMultiplier: '1.00000000000000001',
      functionExecutionMultiplier: null,
    })
    const parsed = adminBillingTierMutationSchema.parse(JSON.parse(JSON.stringify(source)))
    const stored = toBillingTierMutationValues(parsed, 'admin')
    for (const key of [
      'monthlyPriceUsd',
      'yearlyPriceUsd',
      'includedUsageLimitUsd',
      'workflowExecutionMultiplier',
      'workflowModelCostMultiplier',
    ] as const)
      expect(stored[key]).toBe(source[key])
    expect(stored.functionExecutionMultiplier).toBe('1')
    expect(stored.seatCount).toBeNull()
    expect(toBillingTierMutationValues(createTierInput(), 'admin').monthlyPriceUsd).toBeNull()
  })
  it.each([
    0,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    '-0.1',
    'NaN',
    'Infinity',
    '0x10',
    ' 0.3 ',
    '1e131072',
    '1e-16384',
  ])('rejects non-string or invalid/out-of-range monetary input %s', (value) => {
    expect(
      adminBillingTierMutationSchema.safeParse({
        ...createTierInput(),
        includedUsageLimitUsd: value,
      }).success
    ).toBe(false)
  })
  it('normalizes permitted decimal text exactly without an intermediate number', () => {
    expect(
      adminBillingTierMutationSchema.parse(
        createTierInput({ includedUsageLimitUsd: '3.0000000000000001e-1' })
      ).includedUsageLimitUsd
    ).toBe('0.30000000000000001')
  })
  it('keeps unlimited capacity null and refuses unsafe integer quantities', () => {
    expect(adminBillingTierMutationSchema.parse(createTierInput()).concurrencyLimit).toBeNull()
    expect(
      adminBillingTierMutationSchema.safeParse(
        createTierInput({ seatCount: Number.MAX_SAFE_INTEGER + 1 })
      ).success
    ).toBe(false)
  })
  it('keeps tiny positive recurring prices subject to the existing free-tier rule', () => {
    expect(validateAdminBillingTierInput(createTierInput({ monthlyPriceUsd: '1e-16383' }))).toBe(
      'The default tier cannot configure a recurring price'
    )
  })
})
