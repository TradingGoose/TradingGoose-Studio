import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createRestrictedBillingPortalSession } from './stripe-portal'

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
  subscription_update: { enabled: true },
}

function createStripe(configurations: unknown[]) {
  const list = vi.fn().mockResolvedValue({ data: configurations })
  const updateConfiguration = vi.fn().mockResolvedValue({ id: 'bpc_default' })
  const createSession = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.test/session' })

  return {
    stripe: {
      billingPortal: {
        configurations: { list, update: updateConfiguration },
        sessions: { create: createSession },
      },
    } as unknown as Stripe,
    list,
    updateConfiguration,
    createSession,
  }
}

describe('createRestrictedBillingPortalSession', () => {
  it('disables direct login and plan switching on the default portal', async () => {
    const { stripe, list, updateConfiguration, createSession } = createStripe([
      {
        id: 'bpc_default',
        is_default: true,
        business_profile: {},
        login_page: { enabled: true },
        features: defaultFeatures,
      },
    ])

    await createRestrictedBillingPortalSession(stripe, {
      customer: 'cus_123',
      return_url: 'https://example.com/billing',
    })

    expect(list).toHaveBeenCalledWith({ active: true, limit: 100 })
    expect(updateConfiguration).toHaveBeenCalledWith('bpc_default', {
      login_page: { enabled: false },
      features: { subscription_update: { enabled: false } },
    })
    expect(createSession).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://example.com/billing',
      configuration: 'bpc_default',
    })
  })

  it('reuses an already restricted default portal configuration', async () => {
    const { stripe, updateConfiguration, createSession } = createStripe([
      {
        id: 'bpc_default',
        is_default: true,
        login_page: { enabled: false },
        features: { ...defaultFeatures, subscription_update: { enabled: false } },
      },
    ])

    await createRestrictedBillingPortalSession(stripe, { customer: 'cus_123' })

    expect(updateConfiguration).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({
      customer: 'cus_123',
      configuration: 'bpc_default',
    })
  })
})
