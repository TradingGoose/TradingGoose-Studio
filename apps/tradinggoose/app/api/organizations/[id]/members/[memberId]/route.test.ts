/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Organization member DELETE route', () => {
  const selectResults: any[][] = []
  const deleteMock = vi.fn()
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))
  const mockAssertWorkspaceOwnerCanLeaveBillingOrganization = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        delete: deleteMock,
        transaction: vi.fn(),
      },
      member: {
        id: 'member.id',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
        role: 'member.role',
        createdAt: 'member.createdAt',
      },
      subscription: {
        referenceId: 'subscription.referenceId',
        status: 'subscription.status',
        cancelAtPeriodEnd: 'subscription.cancelAtPeriodEnd',
        stripeSubscriptionId: 'subscription.stripeSubscriptionId',
      },
      user: {
        id: 'user.id',
        name: 'user.name',
        email: 'user.email',
      },
      userStats: {
        userId: 'userStats.userId',
        currentPeriodCost: 'userStats.currentPeriodCost',
        customUsageLimit: 'userStats.customUsageLimit',
        customUsageLimitUpdatedAt: 'userStats.customUsageLimitUpdatedAt',
        lastPeriodCost: 'userStats.lastPeriodCost',
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin',
        },
      }),
    }))

    vi.doMock('@/lib/billing/core/usage', () => ({
      getUserUsageData: vi.fn(),
    }))

    vi.doMock('@/lib/billing/stripe-client', () => ({
      requireStripeClient: vi.fn(),
    }))

    vi.doMock('@/lib/billing/tiers', () => ({
      hydrateSubscriptionsWithTiers: vi.fn(),
      isIndividualPaidSubscription: vi.fn(),
      isOrganizationSubscription: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/workspaces/billing-owner', () => ({
      assertWorkspaceOwnerCanLeaveBillingOrganization:
        mockAssertWorkspaceOwnerCanLeaveBillingOrganization,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks removing a workspace owner who still has workspaces billed to the organization', async () => {
    mockAssertWorkspaceOwnerCanLeaveBillingOrganization.mockRejectedValue(
      new Error('Workspace owner must reassign billing before leaving the organization')
    )
    selectResults.push([{ id: 'member-1', role: 'owner' }], [{ id: 'target-1', role: 'member' }])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/organizations/org-1/members/user-2', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'user-2' }) }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Workspace owner must reassign billing before leaving the organization',
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceOwnerCanLeaveBillingOrganization).toHaveBeenCalledWith({
      organizationId: 'org-1',
      workspaceOwnerId: 'user-2',
    })
  })
})
