/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getPlans', () => {
  const getResolvableStripeBillingTiersMock = vi.fn()
  const getTierIncludedUsageLimitMock = vi.fn()
  const parseBillingAmountMock = vi.fn()

  const originalNextPhase = process.env.NEXT_PHASE

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getResolvableStripeBillingTiersMock.mockReset()
    getTierIncludedUsageLimitMock.mockReset()
    parseBillingAmountMock.mockReset()

    vi.doMock('@/lib/billing/tiers', () => ({
      getResolvableStripeBillingTiers: getResolvableStripeBillingTiersMock,
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
    expect(getResolvableStripeBillingTiersMock).not.toHaveBeenCalled()
  })

  it('returns the runtime DB-backed resolver outside the production build phase', async () => {
    process.env.NEXT_PHASE = undefined

    const { getBetterAuthPlansConfig, getPlans } = await import('./plans')

    expect(getBetterAuthPlansConfig()).toBe(getPlans)
  })

  it('keeps archived Stripe-backed tiers internally resolvable at runtime', async () => {
    process.env.NEXT_PHASE = undefined

    getResolvableStripeBillingTiersMock.mockResolvedValue([
      {
        id: 'team',
        status: 'archived',
        isPublic: false,
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
})
