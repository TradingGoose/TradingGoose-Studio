/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getPlans', () => {
  const getActiveStripeBillingTiersMock = vi.fn()
  const getTierIncludedUsageLimitMock = vi.fn()
  const parseBillingAmountMock = vi.fn()

  const originalNextPhase = process.env.NEXT_PHASE

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getActiveStripeBillingTiersMock.mockReset()
    getTierIncludedUsageLimitMock.mockReset()
    parseBillingAmountMock.mockReset()

    vi.doMock('@/lib/billing/tiers', () => ({
      getActiveStripeBillingTiers: getActiveStripeBillingTiersMock,
      getTierIncludedUsageLimit: getTierIncludedUsageLimitMock,
      parseBillingAmount: parseBillingAmountMock,
    }))
  })

  afterEach(() => {
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE
    } else {
      process.env.NEXT_PHASE = originalNextPhase
    }
  })

  it('returns a static build-safe plan config during Next.js production builds', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'

    const { getBetterAuthPlansConfig } = await import('./plans')

    expect(getBetterAuthPlansConfig()).toEqual([])
    expect(getActiveStripeBillingTiersMock).not.toHaveBeenCalled()
  })

  it('returns the runtime DB-backed resolver outside the production build phase', async () => {
    delete process.env.NEXT_PHASE

    const { getBetterAuthPlansConfig, getPlans } = await import('./plans')

    expect(getBetterAuthPlansConfig()).toBe(getPlans)
  })

  it('maps active Stripe-backed private tiers into Better Auth plans at runtime', async () => {
    delete process.env.NEXT_PHASE

    getActiveStripeBillingTiersMock.mockResolvedValue([
      {
        id: 'team',
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
