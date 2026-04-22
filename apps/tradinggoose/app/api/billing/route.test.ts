/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetBillingGateState = vi.fn()
const mockGetSimplifiedBillingSummary = vi.fn()
const mockGetOrganizationBillingData = vi.fn()
const mockRequireStripeClient = vi.fn()
const mockStripeCustomersRetrieve = vi.fn()

const memberTable = {
  role: 'role',
  organizationId: 'organizationId',
  userId: 'userId',
}

const userStatsTable = {
  billingBlocked: 'billingBlocked',
  userId: 'userId',
}

const userTable = {
  id: 'id',
  stripeCustomerId: 'stripeCustomerId',
}

let memberRows: Array<{ role: string }> = []
let userStatsRows: Array<{ blocked: boolean }> = []
let userRows: Array<{ stripeCustomerId: string | null }> = []

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn((table) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => {
          if (table === memberTable) {
            return memberRows
          }

          if (table === userStatsTable) {
            return userStatsRows
          }

          if (table === userTable) {
            return userRows
          }

          return []
        }),
      })),
    })),
  })),
}

vi.mock('@tradinggoose/db', () => ({
  db: mockDb,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: memberTable,
  user: userTable,
  userStats: userStatsTable,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getSimplifiedBillingSummary: mockGetSimplifiedBillingSummary,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: mockGetOrganizationBillingData,
}))

vi.mock('@/lib/billing/settings', () => ({
  getBillingGateState: mockGetBillingGateState,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function createRequest(url: string) {
  return new NextRequest(new URL(url), { method: 'GET' })
}

describe('/api/billing route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    memberRows = []
    userStatsRows = []
    userRows = [{ stripeCustomerId: null }]
    mockRequireStripeClient.mockReturnValue({
      customers: {
        retrieve: mockStripeCustomersRetrieve,
      },
    })
    mockStripeCustomersRetrieve.mockReset()

    mockGetBillingGateState.mockResolvedValue({
      billingEnabled: true,
      stripeConfigured: true,
    })

    mockGetSimplifiedBillingSummary.mockResolvedValue({
      id: 'sub_user_1',
      type: 'individual',
      isPaid: false,
      status: null,
      seats: null,
      metadata: null,
      stripeSubscriptionId: null,
      periodEnd: null,
      tier: {
        id: 'tier_free',
        displayName: 'Free',
        ownerType: 'user',
        usageScope: 'individual',
        seatMode: 'fixed',
        monthlyPriceUsd: 0,
        yearlyPriceUsd: 0,
      },
      usage: {
        current: 0,
        limit: 25,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        lastPeriodCost: 0,
      },
    })
  })

  it('returns the personal billing summary for context=user even when the session is org-active', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    userStatsRows = [{ blocked: true }]

    const { GET } = await import('./route')
    const response = await GET(createRequest('http://localhost:3000/api/billing?context=user'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.context).toBe('user')
    expect(payload.userRole).toBeUndefined()
    expect(payload.data.tier.ownerType).toBe('user')
    expect(payload.data.usage.limit).toBe(25)
    expect(payload.data.billingBlocked).toBe(true)
    expect(payload.data.hasPaymentMethodOnFile).toBe(false)
    expect(payload.data.organizationId).toBeUndefined()
    expect(mockGetSimplifiedBillingSummary).toHaveBeenCalledWith('user-1')
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
  })

  it('reports personal card-on-file state from the Stripe customer default payment method', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    userRows = [{ stripeCustomerId: 'cus_123' }]
    mockGetSimplifiedBillingSummary.mockResolvedValue({
      id: 'sub_user_1',
      type: 'individual',
      isPaid: false,
      status: null,
      seats: null,
      metadata: null,
      stripeSubscriptionId: null,
      periodEnd: null,
      tier: {
        id: 'tier_payg',
        displayName: 'Pay As You Go',
        ownerType: 'user',
        usageScope: 'individual',
        seatMode: 'fixed',
        monthlyPriceUsd: 0,
        yearlyPriceUsd: 0,
        hasStripeMonthlyPriceId: true,
      },
      usage: {
        current: 0,
        limit: 25,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        lastPeriodCost: 0,
      },
    })
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: 'cus_123',
      invoice_settings: {
        default_payment_method: 'pm_123',
      },
    })

    const { GET } = await import('./route')
    const response = await GET(createRequest('http://localhost:3000/api/billing?context=user'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.hasPaymentMethodOnFile).toBe(true)
    expect(mockStripeCustomersRetrieve).toHaveBeenCalledWith('cus_123')
  })

  it('keeps explicit organization billing access restricted to organization members', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    memberRows = []

    const { GET } = await import('./route')
    const response = await GET(
      createRequest('http://localhost:3000/api/billing?context=organization&id=org-1')
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Access denied - not a member of this organization')
  })

  it('returns organization-shaped billing data only for explicit organization context', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    memberRows = [{ role: 'admin' }]
    mockGetOrganizationBillingData.mockResolvedValue({
      organizationId: 'org-1',
      organizationName: 'Acme',
      subscriptionTier: {
        id: 'tier_org',
        displayName: 'Team',
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        monthlyPriceUsd: 20,
        seatCount: 3,
        seatMaximum: 10,
        canEditUsageLimit: true,
        canConfigureSso: true,
      },
      subscriptionStatus: 'active',
      seatPriceUsd: 20,
      seatCount: 3,
      seatMaximum: 10,
      seatMode: 'adjustable',
      totalSeats: 3,
      usedSeats: 2,
      seatsCount: 3,
      totalCurrentUsage: 12,
      totalUsageLimit: 90,
      warningThresholdPercent: 80,
      minimumUsageLimit: 90,
      averageUsagePerMember: 6,
      billingPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
      billingPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
      billingBlocked: false,
      members: [
        {
          userId: 'user-1',
          userName: 'User One',
          userEmail: 'user@example.com',
          currentUsage: 12,
          usageLimit: 45,
          percentUsed: 26.67,
          isOverLimit: false,
          role: 'admin',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          lastActive: new Date('2026-04-10T00:00:00.000Z'),
        },
      ],
    })

    const { GET } = await import('./route')
    const response = await GET(
      createRequest('http://localhost:3000/api/billing?context=organization&id=org-1')
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.context).toBe('organization')
    expect(payload.userRole).toBe('admin')
    expect(payload.data.organizationId).toBe('org-1')
    expect(payload.data.subscriptionTier.ownerType).toBe('organization')
    expect(payload.data.minimumUsageLimit).toBe(90)
    expect(payload.data.members[0].joinedAt).toBe('2026-04-01T00:00:00.000Z')
  })

  it('returns organization billing with billing disabled reflected in the payload', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    memberRows = [{ role: 'admin' }]
    mockGetBillingGateState.mockResolvedValueOnce({
      billingEnabled: false,
      stripeConfigured: false,
    })
    mockGetOrganizationBillingData.mockResolvedValue({
      organizationId: 'org-1',
      organizationName: 'Acme',
      subscriptionTier: null,
      subscriptionStatus: null,
      seatPriceUsd: null,
      seatCount: 0,
      seatMaximum: null,
      seatMode: 'fixed',
      totalSeats: 0,
      usedSeats: 0,
      seatsCount: 0,
      totalCurrentUsage: 0,
      totalUsageLimit: Number.MAX_SAFE_INTEGER,
      warningThresholdPercent: 80,
      minimumUsageLimit: 0,
      averageUsagePerMember: 0,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      billingBlocked: false,
      members: [],
    })

    const { GET } = await import('./route')
    const response = await GET(
      createRequest('http://localhost:3000/api/billing?context=organization&id=org-1')
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.billingEnabled).toBe(false)
    expect(payload.data.organizationId).toBe('org-1')
    expect(payload.data.subscriptionTier).toBeNull()
  })

  it('returns 500 when personal billing summary resolution fails', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    mockGetSimplifiedBillingSummary.mockRejectedValue(new Error('billing invariant failure'))

    const { GET } = await import('./route')
    const response = await GET(createRequest('http://localhost:3000/api/billing?context=user'))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Internal server error')
  })
})
