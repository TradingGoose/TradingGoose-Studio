/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createSelectChain(result: any) {
  const limitedChain: any = {
    limit: vi.fn(() => Promise.resolve(result)),
  }
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => limitedChain),
  }

  return chain
}

describe('Organization members GET route', () => {
  let adminMembershipRows: any[] = []
  let memberRows: any[] = []
  const selectMock = vi.fn((selection?: Record<string, unknown>) => {
    if (selection && 'userName' in selection) {
      const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(memberRows)),
      }

      return chain
    }

    return createSelectChain(adminMembershipRows)
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    adminMembershipRows = []
    memberRows = []

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      invitation: {},
      member: {
        id: 'member.id',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
        role: 'member.role',
        createdAt: 'member.createdAt',
      },
      organization: {
        id: 'organization.id',
        name: 'organization.name',
      },
      user: {
        id: 'user.id',
        name: 'user.name',
        email: 'user.email',
      },
      userStats: {
        currentPeriodCost: 'userStats.currentPeriodCost',
        customUsageLimit: 'userStats.customUsageLimit',
        customUsageLimitUpdatedAt: 'userStats.customUsageLimitUpdatedAt',
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'owner@example.com',
        },
      }),
    }))

    vi.doMock('@/components/emails/render-email', () => ({
      getEmailSubject: vi.fn(),
      renderInvitationEmail: vi.fn(),
    }))

    vi.doMock('@/lib/billing/core/organization', () => ({
      getOrganizationBillingData: vi.fn(),
    }))

    vi.doMock('@/lib/billing/core/usage', () => ({
      getUserUsageData: vi.fn(),
    }))

    vi.doMock('@/lib/billing/validation/seat-management', () => ({
      validateSeatAvailability: vi.fn(),
    }))

    vi.doMock('@/lib/email/mailer', () => ({
      sendEmail: vi.fn(),
    }))

    vi.doMock('@/lib/email/validation', () => ({
      quickValidateEmail: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/urls/utils', () => ({
      getBaseUrl: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns pooled organization usage as shared billing instead of stale user stats', async () => {
    const { getOrganizationBillingData } = await import('@/lib/billing/core/organization')

    vi.mocked(getOrganizationBillingData).mockResolvedValue({
      organizationId: 'org-1',
      organizationName: 'Org',
      subscriptionTier: {
        id: 'tier-org',
        displayName: 'Org',
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'fixed',
        monthlyPriceUsd: 20,
        seatCount: 1,
        seatMaximum: null,
        canEditUsageLimit: true,
        canConfigureSso: true,
      },
      subscriptionStatus: 'active',
      seatPriceUsd: 20,
      seatCount: 1,
      seatMaximum: null,
      seatMode: 'fixed',
      totalSeats: 3,
      usedSeats: 2,
      seatsCount: 3,
      totalCurrentUsage: 42.5,
      totalUsageLimit: 60,
      warningThresholdPercent: 80,
      minimumUsageLimit: 60,
      averageUsagePerMember: 21.25,
      billingPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
      billingPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodCost: 42.5,
      lastPeriodCost: 0,
      billedOverageThisPeriod: 0,
      currentPeriodCopilotCost: 0,
      lastPeriodCopilotCost: 0,
      totalCost: 42.5,
      totalCopilotCost: 0,
      billingBlocked: false,
      members: [
        {
          userId: 'member-1',
          userName: 'Member One',
          userEmail: 'member1@example.com',
          currentUsage: 0,
          usageLimit: 0,
          percentUsed: 0,
          isOverLimit: false,
          role: 'member',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          lastActive: null,
        },
      ],
    })

    adminMembershipRows = [{ id: 'membership-1', role: 'owner' }]
    memberRows = [
      {
        id: 'membership-1',
        userId: 'member-1',
        organizationId: 'org-1',
        role: 'member',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        userName: 'Member One',
        userEmail: 'member1@example.com',
        currentPeriodCost: '9.99',
        customUsageLimit: null,
        customUsageLimitUpdatedAt: null,
      },
    ]

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/organizations/org-1/members?include=usage'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: [
        {
          id: 'membership-1',
          userId: 'member-1',
          organizationId: 'org-1',
          role: 'member',
          createdAt: '2026-04-01T00:00:00.000Z',
          userName: 'Member One',
          userEmail: 'member1@example.com',
          currentPeriodCost: null,
          customUsageLimit: null,
          customUsageLimitUpdatedAt: null,
          billingPeriodStart: '2026-04-01T00:00:00.000Z',
          billingPeriodEnd: '2026-05-01T00:00:00.000Z',
        },
      ],
      total: 1,
      userRole: 'owner',
      hasAdminAccess: true,
      usageScope: 'pooled',
      sharedCurrentPeriodCost: 42.5,
    })
  })

  it('returns individual organization member usage from the member ledger summary', async () => {
    const { getOrganizationBillingData } = await import('@/lib/billing/core/organization')

    vi.mocked(getOrganizationBillingData).mockResolvedValue({
      organizationId: 'org-1',
      organizationName: 'Org',
      subscriptionTier: {
        id: 'tier-org',
        displayName: 'Org',
        ownerType: 'organization',
        usageScope: 'individual',
        seatMode: 'adjustable',
        monthlyPriceUsd: 20,
        seatCount: 1,
        seatMaximum: 10,
        canEditUsageLimit: true,
        canConfigureSso: true,
      },
      subscriptionStatus: 'active',
      seatPriceUsd: 20,
      seatCount: 1,
      seatMaximum: 10,
      seatMode: 'adjustable',
      totalSeats: 3,
      usedSeats: 2,
      seatsCount: 3,
      totalCurrentUsage: 18.75,
      totalUsageLimit: 60,
      warningThresholdPercent: 80,
      minimumUsageLimit: 60,
      averageUsagePerMember: 9.37,
      billingPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
      billingPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodCost: 18.75,
      lastPeriodCost: 0,
      billedOverageThisPeriod: 0,
      currentPeriodCopilotCost: 0,
      lastPeriodCopilotCost: 0,
      totalCost: 18.75,
      totalCopilotCost: 0,
      billingBlocked: false,
      members: [
        {
          userId: 'member-1',
          userName: 'Member One',
          userEmail: 'member1@example.com',
          currentUsage: 12.25,
          usageLimit: 20,
          percentUsed: 61.25,
          isOverLimit: false,
          role: 'member',
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          lastActive: null,
        },
      ],
    })

    adminMembershipRows = [{ id: 'membership-1', role: 'owner' }]
    memberRows = [
      {
        id: 'membership-1',
        userId: 'member-1',
        organizationId: 'org-1',
        role: 'member',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        userName: 'Member One',
        userEmail: 'member1@example.com',
        currentPeriodCost: '0',
        customUsageLimit: null,
        customUsageLimitUpdatedAt: null,
      },
    ]

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/organizations/org-1/members?include=usage'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: [
        {
          id: 'membership-1',
          userId: 'member-1',
          organizationId: 'org-1',
          role: 'member',
          createdAt: '2026-04-01T00:00:00.000Z',
          userName: 'Member One',
          userEmail: 'member1@example.com',
          currentPeriodCost: 12.25,
          customUsageLimit: null,
          customUsageLimitUpdatedAt: null,
          billingPeriodStart: '2026-04-01T00:00:00.000Z',
          billingPeriodEnd: '2026-05-01T00:00:00.000Z',
        },
      ],
      total: 1,
      userRole: 'owner',
      hasAdminAccess: true,
      usageScope: 'individual',
      sharedCurrentPeriodCost: null,
    })
  })
})
