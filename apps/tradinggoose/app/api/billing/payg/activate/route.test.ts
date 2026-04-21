/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureDefaultUserSubscription,
  mockEq,
  mockExecute,
  mockGetBillingGateState,
  mockGetSession,
  mockIsFreeBillingTier,
  mockRequireStripeClient,
  mockRandomUUID,
  mockSql,
  mockStripeCustomersRetrieve,
  mockStripeSubscriptionsCreate,
  mockSyncSubscriptionBillingTierFromStripeSubscription,
  mockSyncSubscriptionUsageLimits,
} = vi.hoisted(() => ({
  mockEnsureDefaultUserSubscription: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  mockExecute: vi.fn(),
  mockGetBillingGateState: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsFreeBillingTier: vi.fn(
    (tier: { monthlyPriceUsd?: number | string | null; yearlyPriceUsd?: number | string | null }) =>
      Number(tier?.monthlyPriceUsd ?? 0) <= 0 && Number(tier?.yearlyPriceUsd ?? 0) <= 0
  ),
  mockRequireStripeClient: vi.fn(),
  mockRandomUUID: vi.fn(),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
  mockStripeCustomersRetrieve: vi.fn(),
  mockStripeSubscriptionsCreate: vi.fn(),
  mockSyncSubscriptionBillingTierFromStripeSubscription: vi.fn(),
  mockSyncSubscriptionUsageLimits: vi.fn(),
}))

const subscriptionTable = {
  id: 'subscription.id',
}

const userTable = {
  id: 'user.id',
  stripeCustomerId: 'user.stripeCustomerId',
}

let userRows: Array<{ stripeCustomerId: string | null }> = []
let subscriptionUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = []

const mockTx = {
  execute: mockExecute,
  select: vi.fn(() => ({
    from: vi.fn((table) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => {
          if (table === userTable) {
            return Promise.resolve(userRows)
          }

          return Promise.resolve([])
        }),
      })),
    })),
  })),
  update: vi.fn((table) => ({
    set: vi.fn((values) => ({
      where: vi.fn(async () => {
        subscriptionUpdates.push({ table, values })
        return []
      }),
    })),
  })),
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn((table) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => {
          if (table === userTable) {
            return Promise.resolve(userRows)
          }

          return Promise.resolve([])
        }),
      })),
    })),
  })),
  update: vi.fn((table) => ({
    set: vi.fn((values) => ({
      where: vi.fn(async () => {
        subscriptionUpdates.push({ table, values })
        return []
      }),
    })),
  })),
  transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx)),
}

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  subscription: subscriptionTable,
  user: userTable,
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
  sql: mockSql,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  ensureDefaultUserSubscription: mockEnsureDefaultUserSubscription,
}))

vi.mock('@/lib/billing/organization', () => ({
  syncSubscriptionUsageLimits: mockSyncSubscriptionUsageLimits,
}))

vi.mock('@/lib/billing/settings', () => ({
  BILLING_DISABLED_ERROR: 'Billing is not enabled.',
  getBillingGateState: mockGetBillingGateState,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  BILLING_ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/billing/tiers', () => ({
  isFreeBillingTier: mockIsFreeBillingTier,
}))

vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription:
    mockSyncSubscriptionBillingTierFromStripeSubscription,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.stubGlobal('crypto', {
  randomUUID: mockRandomUUID,
})

function buildCurrentSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_default_user-1',
    plan: 'tier_payg',
    billingTierId: 'tier_payg',
    referenceType: 'user',
    referenceId: 'user-1',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: 'active',
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    seats: null,
    trialStart: null,
    trialEnd: null,
    metadata: { source: 'default-tier' },
    tier: {
      id: 'tier_payg',
      displayName: 'Pay As You Go',
      status: 'active',
      ownerType: 'user',
      usageScope: 'individual',
      seatMode: 'fixed',
      stripeMonthlyPriceId: 'price_payg',
      monthlyPriceUsd: 0,
      yearlyPriceUsd: 0,
    },
    ...overrides,
  }
}

describe('/api/billing/payg/activate route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    userRows = [{ stripeCustomerId: 'cus_123' }]
    subscriptionUpdates = []
    mockRandomUUID.mockReset()
    mockRandomUUID.mockReturnValue('attempt-1')
    mockExecute.mockReset()
    mockTx.execute.mockClear()
    mockTx.select.mockClear()
    mockTx.update.mockClear()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockEnsureDefaultUserSubscription.mockResolvedValue(buildCurrentSubscription())
    mockRequireStripeClient.mockReturnValue({
      customers: {
        retrieve: mockStripeCustomersRetrieve,
      },
      subscriptions: {
        create: mockStripeSubscriptionsCreate,
      },
    })
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: 'cus_123',
      invoice_settings: {
        default_payment_method: 'pm_123',
      },
    })
    mockStripeSubscriptionsCreate.mockResolvedValue({
      id: 'sub_stripe_123',
      status: 'active',
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            current_period_start: 1_712_905_600,
            current_period_end: 1_715_584_000,
          },
        ],
      },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.error).toBe('Unauthorized')
  })

  it('returns 409 when billing is disabled', async () => {
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: false,
      stripeConfigured: true,
    })

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe('Billing is not enabled.')
  })

  it('rejects activation when the current personal tier is not an activatable PAYG tier', async () => {
    mockEnsureDefaultUserSubscription.mockResolvedValue(
      buildCurrentSubscription({
        tier: {
          ...buildCurrentSubscription().tier,
          stripeMonthlyPriceId: null,
        },
      })
    )

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe(
      'Current billing tier is not an inactive personal pay-as-you-go tier'
    )
    expect(mockStripeSubscriptionsCreate).not.toHaveBeenCalled()
  })

  it('returns already_active when the current PAYG row is already bound to Stripe', async () => {
    mockEnsureDefaultUserSubscription.mockResolvedValue(
      buildCurrentSubscription({
        stripeSubscriptionId: 'sub_existing',
      })
    )

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe('already_active')
    expect(payload.stripeSubscriptionId).toBe('sub_existing')
    expect(mockStripeSubscriptionsCreate).not.toHaveBeenCalled()
  })

  it('requires an existing Stripe customer and default payment method', async () => {
    userRows = [{ stripeCustomerId: null }]

    const { POST } = await import('./route')
    const missingCustomerResponse = await POST()
    const missingCustomerPayload = await missingCustomerResponse.json()

    expect(missingCustomerResponse.status).toBe(409)
    expect(missingCustomerPayload.error).toBe('Stripe customer not found')

    userRows = [{ stripeCustomerId: 'cus_123' }]
    mockStripeCustomersRetrieve.mockResolvedValueOnce({
      id: 'cus_123',
      invoice_settings: {
        default_payment_method: null,
      },
    })

    const noPaymentMethodResponse = await POST()
    const noPaymentMethodPayload = await noPaymentMethodResponse.json()

    expect(noPaymentMethodResponse.status).toBe(409)
    expect(noPaymentMethodPayload.error).toBe('No default payment method on file')
  })

  it('creates the Stripe subscription with deterministic idempotency and updates the existing local row', async () => {
    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      status: 'activated',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    expect(mockStripeSubscriptionsCreate).toHaveBeenCalledWith(
      {
        customer: 'cus_123',
        default_payment_method: 'pm_123',
        items: [{ price: 'price_payg' }],
        metadata: {
          userId: 'user-1',
          subscriptionId: 'sub_default_user-1',
          referenceId: 'user-1',
        },
        off_session: true,
        payment_behavior: 'error_if_incomplete',
      },
      {
        idempotencyKey: 'payg-activate:sub_default_user-1:attempt-1',
      }
    )
    expect(subscriptionUpdates).toEqual([
      {
        table: subscriptionTable,
        values: expect.objectContaining({
          plan: 'tier_payg',
          billingTierId: 'tier_payg',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_stripe_123',
          status: 'active',
          cancelAtPeriodEnd: false,
          periodStart: new Date('2024-04-12T07:06:40.000Z'),
          periodEnd: new Date('2024-05-13T07:06:40.000Z'),
          trialStart: null,
          trialEnd: null,
        }),
      },
    ])
    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).toHaveBeenCalledWith(
      'sub_default_user-1',
      expect.objectContaining({ id: 'sub_stripe_123' })
    )
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub_default_user-1',
        referenceType: 'user',
        referenceId: 'user-1',
        tier: expect.objectContaining({ id: 'tier_payg' }),
        status: 'active',
      })
    )
  })

  it('does not persist a Stripe subscription when Stripe rejects incomplete activation', async () => {
    const stripeError = Object.assign(
      new Error('This payment requires additional user action before it can succeed.'),
      {
        type: 'StripeCardError',
        code: 'authentication_required',
        statusCode: 402,
      }
    )
    mockStripeSubscriptionsCreate.mockRejectedValueOnce(stripeError)

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(402)
    expect(payload).toMatchObject({
      error: 'This payment requires additional user action before it can succeed.',
      code: 'authentication_required',
    })
    expect(subscriptionUpdates).toEqual([])
    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('uses a fresh idempotency key on each retry after a failed activation attempt', async () => {
    const stripeError = Object.assign(new Error('Your card was declined.'), {
      type: 'StripeCardError',
      code: 'card_declined',
      statusCode: 402,
    })
    mockRandomUUID.mockReset()
    mockRandomUUID.mockReturnValueOnce('attempt-1').mockReturnValueOnce('attempt-2')
    mockStripeSubscriptionsCreate.mockRejectedValue(stripeError)

    const { POST } = await import('./route')

    const firstResponse = await POST()
    const secondResponse = await POST()

    expect(firstResponse.status).toBe(402)
    expect(secondResponse.status).toBe(402)
    expect(mockStripeSubscriptionsCreate).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      { idempotencyKey: 'payg-activate:sub_default_user-1:attempt-1' }
    )
    expect(mockStripeSubscriptionsCreate).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      { idempotencyKey: 'payg-activate:sub_default_user-1:attempt-2' }
    )
  })

  it('rejects unsupported non-active Stripe subscription statuses without persisting the row', async () => {
    mockStripeSubscriptionsCreate.mockResolvedValueOnce({
      id: 'sub_stripe_pending',
      status: 'incomplete',
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      items: {
        data: [
          {
            current_period_start: 1_712_905_600,
            current_period_end: 1_715_584_000,
          },
        ],
      },
    })

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe(
      'Stripe returned unsupported subscription status "incomplete" during PAYG activation.'
    )
    expect(subscriptionUpdates).toEqual([])
    expect(mockSyncSubscriptionBillingTierFromStripeSubscription).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })
})
