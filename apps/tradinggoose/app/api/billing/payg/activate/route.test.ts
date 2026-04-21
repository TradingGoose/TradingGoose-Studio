/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureDefaultUserSubscription,
  mockEnsureStripeUserCustomer,
  mockEq,
  mockExecute,
  mockGetBillingGateState,
  mockGetSession,
  mockIsFreeBillingTier,
  mockRequireStripeClient,
  mockRandomUUID,
  mockSql,
  mockStripeSubscriptionsCreate,
  mockStripeSubscriptionsList,
  mockHandleSubscriptionCreated,
  mockSyncSubscriptionUsageLimits,
} = vi.hoisted(() => ({
  mockEnsureDefaultUserSubscription: vi.fn(),
  mockEnsureStripeUserCustomer: vi.fn(),
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
  mockStripeSubscriptionsCreate: vi.fn(),
  mockStripeSubscriptionsList: vi.fn(),
  mockHandleSubscriptionCreated: vi.fn(),
  mockSyncSubscriptionUsageLimits: vi.fn(),
}))

const subscriptionTable = {
  id: 'subscription.id',
}

let subscriptionUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = []

const mockTx = {
  execute: mockExecute,
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

vi.mock('@/lib/billing/stripe-customers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/stripe-customers')>(
    '@/lib/billing/stripe-customers'
  )

  return {
    ...actual,
    ensureStripeUserCustomer: mockEnsureStripeUserCustomer,
  }
})

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  BILLING_ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/billing/tiers', () => ({
  isFreeBillingTier: mockIsFreeBillingTier,
}))

vi.mock('@/lib/billing/webhooks/subscription', () => ({
  handleSubscriptionCreated: mockHandleSubscriptionCreated,
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

function buildStripeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cus_123',
    invoice_settings: {
      default_payment_method: 'pm_123',
    },
    ...overrides,
  }
}

function buildStripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_stripe_123',
    status: 'active',
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    metadata: {
      subscriptionId: 'sub_default_user-1',
    },
    items: {
      data: [
        {
          current_period_start: 1_712_905_600,
          current_period_end: 1_715_584_000,
        },
      ],
    },
    ...overrides,
  }
}

function expectActivationAttemptMetadataPersisted() {
  expect(subscriptionUpdates).toEqual(
    expect.arrayContaining([
      {
        table: subscriptionTable,
        values: {
          metadata: {
            source: 'default-tier',
            paygActivationAttemptId: 'attempt-1',
          },
        },
      },
    ])
  )
}

function expectActivationAttemptMetadataCleared() {
  expect(subscriptionUpdates).toEqual(
    expect.arrayContaining([
      {
        table: subscriptionTable,
        values: {
          metadata: {
            source: 'default-tier',
          },
        },
      },
    ])
  )
}

function expectPersistedStripeSubscriptionUpdate(stripeSubscriptionId: string) {
  expect(subscriptionUpdates).toEqual(
    expect.arrayContaining([
      {
        table: subscriptionTable,
        values: expect.objectContaining({
          stripeSubscriptionId,
          status: 'active',
          metadata: {
            source: 'default-tier',
          },
        }),
      },
    ])
  )
}

describe('/api/billing/payg/activate route', () => {
  let stripeClient: {
    subscriptions: {
      list: typeof mockStripeSubscriptionsList
      create: typeof mockStripeSubscriptionsCreate
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    subscriptionUpdates = []
    mockRandomUUID.mockReset()
    mockRandomUUID.mockReturnValue('attempt-1')
    mockExecute.mockReset()
    mockTx.execute.mockClear()
    mockTx.update.mockClear()

    stripeClient = {
      subscriptions: {
        list: mockStripeSubscriptionsList,
        create: mockStripeSubscriptionsCreate,
      },
    }

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockEnsureDefaultUserSubscription.mockResolvedValue(buildCurrentSubscription())
    mockEnsureStripeUserCustomer.mockResolvedValue(buildStripeCustomer())
    mockRequireStripeClient.mockReturnValue(stripeClient)
    mockStripeSubscriptionsList.mockResolvedValue({
      data: [],
    })
    mockStripeSubscriptionsCreate.mockResolvedValue(buildStripeSubscription())
    mockHandleSubscriptionCreated.mockResolvedValue(undefined)
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
    expect(mockEnsureStripeUserCustomer).not.toHaveBeenCalled()
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
    expect(mockEnsureStripeUserCustomer).not.toHaveBeenCalled()
    expect(mockStripeSubscriptionsCreate).not.toHaveBeenCalled()
  })

  it('uses the shared personal Stripe customer contract before requiring a default payment method', async () => {
    mockEnsureStripeUserCustomer.mockResolvedValueOnce(null)

    const { POST } = await import('./route')
    const missingUserResponse = await POST()
    const missingUserPayload = await missingUserResponse.json()

    expect(missingUserResponse.status).toBe(404)
    expect(missingUserPayload.error).toBe('User not found')

    mockEnsureStripeUserCustomer.mockResolvedValueOnce(
      buildStripeCustomer({
        invoice_settings: {
          default_payment_method: null,
        },
      })
    )

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
    expect(mockEnsureStripeUserCustomer).toHaveBeenCalledWith(
      stripeClient,
      expect.objectContaining({
        userId: 'user-1',
      })
    )
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
    expectActivationAttemptMetadataPersisted()
    expect(subscriptionUpdates).toEqual(
      expect.arrayContaining([
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
            metadata: {
              source: 'default-tier',
            },
          }),
        },
      ])
    )
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub_default_user-1',
        referenceType: 'user',
        referenceId: 'user-1',
        stripeSubscriptionId: 'sub_stripe_123',
        status: 'active',
        tier: expect.objectContaining({ id: 'tier_payg' }),
      })
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

  it('skips creation-side effects when another request already persisted the activation locally', async () => {
    mockEnsureDefaultUserSubscription
      .mockResolvedValueOnce(buildCurrentSubscription())
      .mockResolvedValueOnce(
        buildCurrentSubscription({
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_stripe_123',
        })
      )

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      status: 'activated',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    expectActivationAttemptMetadataPersisted()
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('reconciles an already-created active Stripe subscription before creating another one', async () => {
    mockStripeSubscriptionsList.mockResolvedValueOnce({
      data: [buildStripeSubscription({ id: 'sub_stripe_existing' })],
    })

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      status: 'activated',
      stripeSubscriptionId: 'sub_stripe_existing',
    })
    expect(mockStripeSubscriptionsCreate).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_stripe_existing',
        status: 'active',
      })
    )
    expectActivationAttemptMetadataPersisted()
    expectPersistedStripeSubscriptionUpdate('sub_stripe_existing')
  })

  it('recovers an already-created active Stripe subscription even if no default payment method is on file anymore', async () => {
    mockEnsureStripeUserCustomer.mockResolvedValueOnce(
      buildStripeCustomer({
        invoice_settings: {
          default_payment_method: null,
        },
      })
    )
    mockStripeSubscriptionsList.mockResolvedValueOnce({
      data: [buildStripeSubscription({ id: 'sub_stripe_existing' })],
    })

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      status: 'activated',
      stripeSubscriptionId: 'sub_stripe_existing',
    })
    expect(mockStripeSubscriptionsCreate).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_stripe_existing',
        status: 'active',
      })
    )
  })

  it('ignores canceled historical Stripe subscriptions when reactivating PAYG', async () => {
    mockStripeSubscriptionsList.mockResolvedValueOnce({
      data: [buildStripeSubscription({ id: 'sub_stripe_old', status: 'canceled' })],
    })

    const { POST } = await import('./route')
    const response = await POST()

    expect(response.status).toBe(200)
    expect(mockStripeSubscriptionsCreate).toHaveBeenCalledOnce()
    expect(mockStripeSubscriptionsCreate).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: 'payg-activate:sub_default_user-1:attempt-1',
    })
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
    expectActivationAttemptMetadataPersisted()
    expectActivationAttemptMetadataCleared()
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled()
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
    expect(mockStripeSubscriptionsCreate).toHaveBeenNthCalledWith(1, expect.any(Object), {
      idempotencyKey: 'payg-activate:sub_default_user-1:attempt-1',
    })
    expect(mockStripeSubscriptionsCreate).toHaveBeenNthCalledWith(2, expect.any(Object), {
      idempotencyKey: 'payg-activate:sub_default_user-1:attempt-2',
    })
  })

  it('rejects unsupported non-active Stripe subscription statuses without persisting the row', async () => {
    mockStripeSubscriptionsCreate.mockResolvedValueOnce(
      buildStripeSubscription({ id: 'sub_stripe_pending', status: 'incomplete' })
    )

    const { POST } = await import('./route')
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe(
      'Stripe returned unsupported subscription status "incomplete" during PAYG activation.'
    )
    expectActivationAttemptMetadataPersisted()
    expectActivationAttemptMetadataCleared()
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('retries activation reconciliation after a post-subscription sync failure without creating a second Stripe subscription', async () => {
    mockEnsureDefaultUserSubscription
      .mockResolvedValueOnce(buildCurrentSubscription())
      .mockResolvedValueOnce(
        buildCurrentSubscription({
          metadata: {
            source: 'default-tier',
            paygActivationAttemptId: 'attempt-1',
          },
        })
      )
      .mockResolvedValueOnce(
        buildCurrentSubscription({
          metadata: {
            source: 'default-tier',
            paygActivationAttemptId: 'attempt-1',
          },
        })
      )
      .mockResolvedValueOnce(
        buildCurrentSubscription({
          metadata: {
            source: 'default-tier',
            paygActivationAttemptId: 'attempt-1',
          },
        })
      )
    mockStripeSubscriptionsList
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [buildStripeSubscription()] })
    mockSyncSubscriptionUsageLimits.mockRejectedValueOnce(new Error('sync failed'))

    const { POST } = await import('./route')

    const firstResponse = await POST()
    const secondResponse = await POST()
    const secondPayload = await secondResponse.json()

    expect(firstResponse.status).toBe(500)
    expect(secondResponse.status).toBe(200)
    expect(secondPayload).toMatchObject({
      success: true,
      status: 'activated',
      stripeSubscriptionId: 'sub_stripe_123',
    })
    expect(mockStripeSubscriptionsCreate).toHaveBeenCalledTimes(1)
    expect(
      subscriptionUpdates.filter(
        (update) => update.table === subscriptionTable && 'stripeSubscriptionId' in update.values
      )
    ).toHaveLength(1)
    expectActivationAttemptMetadataPersisted()
    expectPersistedStripeSubscriptionUpdate('sub_stripe_123')
  })
})
