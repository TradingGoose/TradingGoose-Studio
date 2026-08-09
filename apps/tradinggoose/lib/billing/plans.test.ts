/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getPlans', () => {
  const getActiveStripeBackedBillingTiersMock = vi.fn()
  const getTierIncludedUsageLimitMock = vi.fn()
  const parseBillingAmountMock = vi.fn()

  const originalNextPhase = process.env.NEXT_PHASE

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getActiveStripeBackedBillingTiersMock.mockReset()
    getTierIncludedUsageLimitMock.mockReset()
    parseBillingAmountMock.mockReset()

    vi.doMock('@/lib/billing/tiers', () => ({
      getActiveStripeBackedBillingTiers: getActiveStripeBackedBillingTiersMock,
      getTierIncludedUsageLimit: getTierIncludedUsageLimitMock,
      parseBillingAmount: parseBillingAmountMock,
    }))
  })

  afterEach(() => {
    if (originalNextPhase === undefined) {
      process.env.NEXT_PHASE = undefined
    } else {
      process.env.NEXT_PHASE = originalNextPhase
    }
  })

  it('returns a static build-safe plan config during Next.js production builds', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'

    const { getBetterAuthPlansConfig } = await import('./plans')

    expect(getBetterAuthPlansConfig()).toEqual([])
    expect(getActiveStripeBackedBillingTiersMock).not.toHaveBeenCalled()
  })

  it('returns the runtime DB-backed resolver outside the production build phase', async () => {
    process.env.NEXT_PHASE = undefined

    const { getBetterAuthPlansConfig, getPlans } = await import('./plans')

    expect(getBetterAuthPlansConfig()).toBe(getPlans)
  })

  it('maps active Stripe price-backed tiers into Better Auth plans at runtime', async () => {
    process.env.NEXT_PHASE = undefined

    getActiveStripeBackedBillingTiersMock.mockResolvedValue([
      {
        id: 'team',
        stripeMonthlyPriceId: 'price_monthly',
        stripeYearlyPriceId: 'price_yearly',
        monthlyPriceUsd: '49',
      },
    ])
    getTierIncludedUsageLimitMock.mockReturnValue(25)
    parseBillingAmountMock.mockReturnValue(49)

    const { getPlans } = await import('./plans')

    await expect(getPlans()).resolves.toEqual([
      {
        name: 'team',
        priceId: 'price_monthly',
        annualDiscountPriceId: 'price_yearly',
        limits: {
          cost: 25,
        },
      },
    ])
  })

  it('uses a yearly-only price as the provider priceId', async () => {
    getActiveStripeBackedBillingTiersMock.mockResolvedValue([
      {
        id: 'private-yearly',
        stripeMonthlyPriceId: null,
        stripeYearlyPriceId: 'price_yearly',
        monthlyPriceUsd: null,
      },
    ])
    getTierIncludedUsageLimitMock.mockReturnValue(10)
    const { getPlans } = await import('./plans')
    await expect(getPlans()).resolves.toEqual([
      {
        name: 'private-yearly',
        priceId: 'price_yearly',
        annualDiscountPriceId: undefined,
        limits: { cost: 10 },
      },
    ])
  })
})
