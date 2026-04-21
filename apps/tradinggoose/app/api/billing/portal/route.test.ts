/**
 * @vitest-environment node
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetBillingGateState = vi.fn()
const mockIsOrganizationOwnerOrAdmin = vi.fn()
const mockRequireStripeClient = vi.fn()
const mockStripeCustomersCreate = vi.fn()
const mockStripeCustomersRetrieve = vi.fn()
const mockStripeBillingPortalSessionsCreate = vi.fn()
const mockEq = vi.fn((field: unknown, value: unknown) => ({ field, value }))
const mockAnd = vi.fn((...conditions: unknown[]) => conditions)
const mockOr = vi.fn((...conditions: unknown[]) => conditions)
const mockInArray = vi.fn((field: unknown, values: unknown[]) => ({ field, values }))
const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  strings,
  values,
}))
const mockExecute = vi.fn()

const subscriptionTable = {
  stripeCustomerId: 'subscription.stripeCustomerId',
  referenceType: 'subscription.referenceType',
  referenceId: 'subscription.referenceId',
  status: 'subscription.status',
  cancelAtPeriodEnd: 'subscription.cancelAtPeriodEnd',
}

const userTable = {
  id: 'user.id',
  stripeCustomerId: 'user.stripeCustomerId',
  email: 'user.email',
  name: 'user.name',
}

let subscriptionRows: Array<{ customer: string | null }> = []
let userRows: Array<{ customer: string | null; email: string; name: string }> = []
let userUpdates: Array<Record<string, unknown>> = []
let persistUserUpdate = true

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
        if (table === userTable) {
          userUpdates.push(values)
          if (persistUserUpdate && userRows[0]) {
            userRows[0] = {
              ...userRows[0],
              customer: values.stripeCustomerId as string | null,
            }
          }
        }
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
          if (table === subscriptionTable) {
            return Promise.resolve(subscriptionRows)
          }

          if (table === userTable) {
            return Promise.resolve(userRows)
          }

          return Promise.resolve([])
        }),
      })),
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
  and: mockAnd,
  eq: mockEq,
  inArray: mockInArray,
  or: mockOr,
  sql: mockSql,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
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

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'https://example.com',
}))

function createRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL('http://localhost:3000/api/billing/portal'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/billing/portal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    subscriptionRows = [{ customer: 'cus_org_123' }]
    userRows = [{ customer: null, email: 'user@example.com', name: 'Portal User' }]
    userUpdates = []
    persistUserUpdate = true

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockRequireStripeClient.mockReturnValue({
      customers: {
        create: mockStripeCustomersCreate,
        retrieve: mockStripeCustomersRetrieve,
      },
      billingPortal: {
        sessions: {
          create: mockStripeBillingPortalSessionsCreate,
        },
      },
    })
    mockStripeCustomersCreate.mockResolvedValue({
      id: 'cus_user_123',
    })
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: 'cus_existing',
    })
    mockStripeBillingPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    })
  })

  it('serializes personal Stripe customer creation and uses a deterministic idempotency key', async () => {
    const { POST } = await import('./route')
    const response = await POST(createRequest({ context: 'user' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.url).toBe('https://billing.stripe.test/session')
    expect(mockExecute).toHaveBeenCalledOnce()
    expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        name: 'Portal User',
        metadata: {
          userId: 'user-1',
          customerType: 'user',
        },
      },
      {
        idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
      }
    )
    expect(userUpdates).toEqual([
      expect.objectContaining({
        stripeCustomerId: 'cus_user_123',
      }),
    ])
    expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_user_123',
      return_url: 'https://example.com/workspace?billing=updated',
    })
  })

  it('reuses the stored personal Stripe customer without creating a new one', async () => {
    userRows = [{ customer: 'cus_existing', email: 'user@example.com', name: 'Portal User' }]

    const { POST } = await import('./route')
    const response = await POST(createRequest({ context: 'user' }))

    expect(response.status).toBe(200)
    expect(mockStripeCustomersCreate).not.toHaveBeenCalled()
    expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_existing')
    expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_existing',
      return_url: 'https://example.com/workspace?billing=updated',
    })
  })

  it('recreates a stored personal Stripe customer when the saved customer no longer exists', async () => {
    userRows = [{ customer: 'cus_stale', email: 'user@example.com', name: 'Portal User' }]
    mockStripeCustomersRetrieve.mockRejectedValueOnce(
      Object.assign(new Error('No such customer'), { code: 'resource_missing' })
    )

    const { POST } = await import('./route')
    const response = await POST(createRequest({ context: 'user' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.url).toBe('https://billing.stripe.test/session')
    expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_stale')
    expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        name: 'Portal User',
        metadata: {
          userId: 'user-1',
          customerType: 'user',
        },
      },
      {
        idempotencyKey: `billing-portal:user-customer-replacement:${createHash('sha256').update('user-1:cus_stale').digest('hex')}`,
      }
    )
    expect(userUpdates).toEqual([
      expect.objectContaining({
        stripeCustomerId: 'cus_user_123',
      }),
    ])
    expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_user_123',
      return_url: 'https://example.com/workspace?billing=updated',
    })
  })

  it('does not recreate or overwrite the stored personal Stripe customer on transient lookup failures', async () => {
    userRows = [{ customer: 'cus_existing', email: 'user@example.com', name: 'Portal User' }]
    mockStripeCustomersRetrieve.mockRejectedValueOnce(new Error('Stripe API unavailable'))

    const { POST } = await import('./route')
    const response = await POST(createRequest({ context: 'user' }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Failed to create billing portal session')
    expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_existing')
    expect(mockStripeCustomersCreate).not.toHaveBeenCalled()
    expect(userUpdates).toEqual([])
    expect(mockStripeBillingPortalSessionsCreate).not.toHaveBeenCalled()
  })

  it('reuses the same Stripe idempotency key if local persistence is lost between retries', async () => {
    persistUserUpdate = false

    const { POST } = await import('./route')

    const firstResponse = await POST(createRequest({ context: 'user' }))
    const secondResponse = await POST(createRequest({ context: 'user' }))

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockStripeCustomersCreate).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      {
        idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
      }
    )
    expect(mockStripeCustomersCreate).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      {
        idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
      }
    )
  })
})
