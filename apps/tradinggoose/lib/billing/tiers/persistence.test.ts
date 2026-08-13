/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { select, update } = vi.hoisted(() => ({
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
    stripeMonthlyPriceId: 'tier.stripeMonthlyPriceId',
    stripeYearlyPriceId: 'tier.stripeYearlyPriceId',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ field, value }),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}))

function stripeSubscription(priceId: string) {
  return {
    id: 'sub_stripe',
    items: { data: [{ price: { id: priceId } }] },
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

  it('uses the callback-provided tier ID and verifies its Stripe price', async () => {
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await syncSubscriptionBillingTierFromStripeSubscription({
      subscriptionId: 'sub_local',
      billingTierId: 'tier_team',
      stripeSubscription: stripeSubscription('price_yearly'),
    })

    expect(set).toHaveBeenCalledWith({
      billingTierId: 'tier_team',
      referenceType: 'organization',
    })
  })

  it('rejects a Stripe price that does not belong to the known tier', async () => {
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        billingTierId: 'tier_team',
        stripeSubscription: stripeSubscription('price_other'),
      })
    ).rejects.toThrow('does not match billing tier tier_team')

    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an organization tier attached to a non-organization reference', async () => {
    selectResults[2] = []
    const { syncSubscriptionBillingTierFromStripeSubscription } = await import('./persistence')

    await expect(
      syncSubscriptionBillingTierFromStripeSubscription({
        subscriptionId: 'sub_local',
        billingTierId: 'tier_team',
        stripeSubscription: stripeSubscription('price_monthly'),
      })
    ).rejects.toThrow('does not reference an organization')

    expect(update).not.toHaveBeenCalled()
  })
})
