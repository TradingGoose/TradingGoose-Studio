/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { and, eq, inArray, or, select, update } = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  or: vi.fn((...conditions: unknown[]) => ({ or: conditions })),
  select: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({ db: { select, update } }))
vi.mock('@tradinggoose/db/schema', () => ({
  subscription: { id: 'subscription.id' },
  organization: { id: 'organization.id' },
  user: { id: 'user.id' },
  systemBillingTier: {
    id: 'tier.id',
    displayName: 'tier.displayName',
    ownerType: 'tier.ownerType',
    status: 'tier.status',
    stripeMonthlyPriceId: 'tier.stripeMonthlyPriceId',
    stripeYearlyPriceId: 'tier.stripeYearlyPriceId',
  },
}))
vi.mock('drizzle-orm', () => ({
  and,
  eq,
  inArray,
  or,
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}))

function stripeSubscription(priceId: string, recurring = true) {
  return {
    id: 'sub_stripe',
    customer: 'customer_signed',
    items: { data: [{ price: { id: priceId, recurring: recurring ? {} : null } }] },
  } as never
}

describe('syncSubscriptionBillingTierFromStripeSubscription', () => {
  const tier = {
    id: 'tier_team',
    displayName: 'Team',
    ownerType: 'organization',
    stripeMonthlyPriceId: 'price_monthly',
    stripeYearlyPriceId: 'price_yearly',
  }
  const set = vi.fn()
  let selectResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    selectResults = [[tier], [{ referenceId: 'org_team' }], [{ id: 'org_team' }]]
    select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: vi.fn().mockResolvedValue(selectResults.shift() ?? []) }),
      }),
    }))
    set.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    update.mockReturnValue({ set })
  })

  it('resolves the tier from the signed recurring Stripe price', async () => {
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await syncSubscriptionBillingTierFromStripeSubscription({
      subscriptionId: 'sub_local',
      stripeSubscription: stripeSubscription('price_yearly'),
    })

    expect(inArray).toHaveBeenCalledWith('tier.status', ['active', 'archived'])
    expect(inArray).toHaveBeenCalledWith('tier.stripeMonthlyPriceId', ['price_yearly'])
    expect(inArray).toHaveBeenCalledWith('tier.stripeYearlyPriceId', ['price_yearly'])
    expect(set).toHaveBeenCalledWith({
      billingTierId: 'tier_team',
      referenceType: 'organization',
      stripeCustomerId: 'customer_signed',
    })
  })

  it('rejects a signed recurring price that matches no tier', async () => {
    selectResults = [[]]
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        stripeSubscription: stripeSubscription('price_other'),
      })
    ).rejects.toThrow('matched 0 billing tiers')

    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a signed recurring price that matches multiple tiers', async () => {
    selectResults = [[tier, { ...tier, id: 'tier_other' }]]
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        stripeSubscription: stripeSubscription('price_monthly'),
      })
    ).rejects.toThrow('matched 2 billing tiers')

    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a Stripe subscription without a recurring price', async () => {
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        stripeSubscription: stripeSubscription('price_one_time', false),
      })
    ).rejects.toThrow('has no recurring price')

    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an organization tier attached to a non-organization reference', async () => {
    selectResults[2] = []
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        stripeSubscription: stripeSubscription('price_monthly'),
      })
    ).rejects.toThrow('does not reference an organization')

    expect(update).not.toHaveBeenCalled()
  })
})
