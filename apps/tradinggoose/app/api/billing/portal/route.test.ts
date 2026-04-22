/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetBillingGateState = vi.fn()
const mockIsOrganizationOwnerOrAdmin = vi.fn()
const mockRequireStripeClient = vi.fn()
const mockEnsureStripeUserCustomer = vi.fn()
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

let subscriptionRows: Array<{ customer: string | null }> = []

const mockTx = {
  execute: mockExecute,
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn((table) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => {
          if (table === subscriptionTable) {
            return Promise.resolve(subscriptionRows)
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

vi.mock('@/lib/billing/stripe-customers', () => ({
  ensureStripeUserCustomer: mockEnsureStripeUserCustomer,
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

async function postPortal(body: Record<string, unknown> = { context: 'user' }) {
  const { POST } = await import('./route')
  return POST(createRequest(body))
}

function expectPortalSession(customer: string) {
  expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
    customer,
    return_url: 'https://example.com/workspace?billing=updated',
  })
}

describe('/api/billing/portal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    subscriptionRows = [{ customer: 'cus_org_123' }]

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockRequireStripeClient.mockReturnValue({
      billingPortal: {
        sessions: {
          create: mockStripeBillingPortalSessionsCreate,
        },
      },
    })
    mockEnsureStripeUserCustomer.mockResolvedValue({
      id: 'cus_user_123',
    })
    mockStripeBillingPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    })
  })

  it('opens a personal billing portal session from the shared Stripe customer result', async () => {
    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.url).toBe('https://billing.stripe.test/session')
    expect(mockExecute).toHaveBeenCalledOnce()
    expect(mockEnsureStripeUserCustomer).toHaveBeenCalledWith(expect.any(Object), {
      dbClient: mockTx,
      logger: expect.any(Object),
      userId: 'user-1',
    })
    expectPortalSession('cus_user_123')
  })

  it('returns 404 when no personal user record can be resolved', async () => {
    mockEnsureStripeUserCustomer.mockResolvedValueOnce(null)

    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe('User not found')
    expect(mockStripeBillingPortalSessionsCreate).not.toHaveBeenCalled()
  })

  it('returns 500 when shared personal customer resolution fails', async () => {
    mockEnsureStripeUserCustomer.mockRejectedValueOnce(new Error('Stripe API unavailable'))

    const response = await postPortal()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Failed to create billing portal session')
    expect(mockStripeBillingPortalSessionsCreate).not.toHaveBeenCalled()
  })

  it('opens an organization billing portal session without invoking the personal customer helper', async () => {
    const response = await postPortal({
      context: 'organization',
      organizationId: 'org-1',
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.url).toBe('https://billing.stripe.test/session')
    expect(mockEnsureStripeUserCustomer).not.toHaveBeenCalled()
    expectPortalSession('cus_org_123')
  })
})
