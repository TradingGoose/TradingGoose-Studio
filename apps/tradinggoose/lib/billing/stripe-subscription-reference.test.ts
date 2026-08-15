/**
 * @vitest-environment node
 */
import { stripe } from '@better-auth/stripe'
import { betterAuth } from 'better-auth'
import { testUtils } from 'better-auth/plugins'
import type Stripe from 'stripe'
import { expect, it, vi } from 'vitest'

it('uses the user Stripe customer for an organization subscription reference', async () => {
  const checkoutCreate = vi.fn().mockResolvedValue({
    id: 'checkout-1',
    url: 'https://checkout.stripe.test/session',
  })
  const customerCreate = vi.fn().mockResolvedValue({ id: 'customer-1' })
  const stripeClient = {
    checkout: { sessions: { create: checkoutCreate } },
    customers: {
      create: customerCreate,
      search: vi.fn().mockResolvedValue({ data: [] }),
    },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  } as unknown as Stripe

  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-that-is-long-enough-for-better-auth',
    plugins: [
      stripe({
        stripeClient,
        stripeWebhookSecret: 'webhook-secret',
        subscription: {
          enabled: true,
          plans: [{ name: 'team', priceId: 'price-team' }],
          authorizeReference: async ({ referenceId }) => referenceId === 'organization-1',
        },
      }),
      testUtils(),
    ],
  })
  const context = await auth.$context
  const testUser = context.test.createUser({ id: 'user-1' })
  await context.test.saveUser(testUser)
  const { headers } = await context.test.login({ userId: testUser.id })

  await expect(
    auth.api.upgradeSubscription({
      headers,
      body: {
        plan: 'team',
        referenceId: 'organization-1',
        successUrl: '/billing/success',
        cancelUrl: '/billing',
        disableRedirect: true,
      },
    })
  ).resolves.toMatchObject({
    url: 'https://checkout.stripe.test/session',
    redirect: false,
  })

  await expect(
    context.adapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: testUser.id }],
    })
  ).resolves.toMatchObject({ stripeCustomerId: 'customer-1' })
  await expect(
    context.adapter.findOne({
      model: 'subscription',
      where: [{ field: 'referenceId', value: 'organization-1' }],
    })
  ).resolves.toMatchObject({
    referenceId: 'organization-1',
    stripeCustomerId: 'customer-1',
  })
  expect(customerCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ customerType: 'user', userId: testUser.id }),
    })
  )
  expect(checkoutCreate).toHaveBeenCalledWith(
    expect.objectContaining({ customer: 'customer-1' }),
    undefined
  )
})
