import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveStripeBillingTiers } = vi.hoisted(() => ({
  getActiveStripeBillingTiers: vi.fn(),
}))

vi.mock('@/lib/billing/tiers', () => ({ getActiveStripeBillingTiers }))

const defaultFeatures = {
  customer_update: { enabled: true, allowed_updates: ['email'] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: {
    enabled: true,
    mode: 'at_period_end',
    proration_behavior: 'none',
    cancellation_reason: { enabled: false, options: [] },
  },
  subscription_update: {
    enabled: false,
    default_allowed_updates: [],
    proration_behavior: 'none',
    products: [],
  },
}

function createStripe(configurations: unknown[]) {
  const list = vi.fn().mockResolvedValue({ data: configurations })
  const update = vi.fn().mockResolvedValue({ id: 'bpc_default' })
  const create = vi.fn().mockResolvedValue({ id: 'bpc_management' })
  const createSession = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.test/session' })
  const retrievePrice = vi.fn().mockImplementation(async (id: string) => ({
    id,
    active: true,
    recurring: { interval: 'month' },
    product: 'prod_team',
  }))

  return {
    stripe: {
      prices: { retrieve: retrievePrice },
      billingPortal: {
        configurations: { create, list, update },
        sessions: { create: createSession },
      },
    } as unknown as Stripe,
    create,
    createSession,
    retrievePrice,
    update,
  }
}

describe('Stripe portal configurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveStripeBillingTiers.mockResolvedValue([
      {
        id: 'private-team',
        stripeProductId: null,
        stripeMonthlyPriceId: 'price_monthly',
        stripeYearlyPriceId: 'price_yearly',
      },
    ])
  })

  it('enrolls every active tier price in the default plan-change catalog', async () => {
    const { stripe, update } = createStripe([
      {
        id: 'bpc_default',
        is_default: true,
        business_profile: {},
        login_page: { enabled: false },
        features: defaultFeatures,
      },
    ])
    const { ensurePlanChangePortalConfiguration } = await import('./stripe-portal')

    await ensurePlanChangePortalConfiguration(stripe)

    expect(update).toHaveBeenCalledWith('bpc_default', {
      login_page: { enabled: false },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'create_prorations',
          products: [
            {
              product: 'prod_team',
              prices: ['price_monthly', 'price_yearly'],
            },
          ],
        },
      },
    })
  })

  it('rejects invalid or oversized active catalogs', async () => {
    const { stripe, retrievePrice } = createStripe([])
    const { buildPlanChangePortalCatalog } = await import('./stripe-portal')
    const tier = {
      stripeProductId: null,
      stripeMonthlyPriceId: 'price',
      stripeYearlyPriceId: null,
    }
    const price = {
      id: 'price',
      active: true,
      recurring: { interval: 'month' },
      product: 'prod_team',
    }
    retrievePrice.mockResolvedValueOnce({ ...price, recurring: null })
    await expect(buildPlanChangePortalCatalog(stripe, [tier])).rejects.toThrow('active recurring')

    retrievePrice.mockResolvedValueOnce({ ...price, product: 'prod_other' })
    await expect(
      buildPlanChangePortalCatalog(stripe, [{ ...tier, stripeProductId: 'prod_expected' }])
    ).rejects.toThrow('does not belong')

    retrievePrice.mockImplementation(async (id: string) => ({
      ...price,
      id,
      product: `prod_${id}`,
    }))
    const tiers = Array.from({ length: 11 }, (_, index) => ({
      ...tier,
      stripeMonthlyPriceId: `price_${index}`,
    }))
    await expect(buildPlanChangePortalCatalog(stripe, tiers)).rejects.toThrow('at most 10')
  })

  it('creates a marked non-default configuration for generic management', async () => {
    const { stripe, create, createSession } = createStripe([
      {
        id: 'bpc_default',
        is_default: true,
        business_profile: {},
        login_page: { enabled: false },
        features: defaultFeatures,
      },
    ])
    const { createBillingManagementPortalSession } = await import('./stripe-portal')

    await createBillingManagementPortalSession(stripe, { customer: 'cus_123' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({
          subscription_update: { enabled: false },
        }),
        login_page: { enabled: false },
        metadata: { tradinggoose_purpose: 'billing_management' },
      })
    )
    expect(createSession).toHaveBeenCalledWith({
      customer: 'cus_123',
      configuration: 'bpc_management',
    })
  })
})
