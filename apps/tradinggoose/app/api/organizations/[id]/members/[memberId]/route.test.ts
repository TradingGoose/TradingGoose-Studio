/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Organization member DELETE route', () => {
  const selectResults: any[][] = []
  const deleteMock = vi.fn()
  const events: string[] = []
  const callerTransaction = { delete: deleteMock }
  const globalDeleteMock = vi.fn(() => {
    throw new Error('Member deletion must use the financial transaction')
  })
  const mockGetSession = vi.fn()
  const mockMutateOrganizationFinancialScope = vi.fn()
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
    events.length = 0
    deleteMock.mockReset().mockImplementation(() => {
      events.push('delete')
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'target-1', userId: 'user-2' }]),
        })),
      }
    })
    mockAssertWorkspaceOwnerCanLeaveBillingOrganization.mockReset().mockImplementation(async () => {
      events.push('leave-check')
    })
    mockMutateOrganizationFinancialScope
      .mockReset()
      .mockImplementation(async (_organizationId, mutation) => {
        events.push('financial-transaction')
        return mutation(callerTransaction)
      })
    mockGetSession.mockReset().mockResolvedValue({
      user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' },
    })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        delete: globalDeleteMock,
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
      getSession: mockGetSession,
    }))

    vi.doMock('@/lib/billing/financial-membership', () => ({
      mutateOrganizationFinancialScope: mockMutateOrganizationFinancialScope,
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
    const { FinancialPolicyError } = await import('@tradinggoose/billing')
    mockAssertWorkspaceOwnerCanLeaveBillingOrganization.mockRejectedValue(
      new FinancialPolicyError(
        'Workspace owner must reassign billing before leaving the organization'
      )
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
    expect(globalDeleteMock).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceOwnerCanLeaveBillingOrganization).toHaveBeenCalledWith(
      { organizationId: 'org-1', workspaceOwnerId: 'user-2' },
      callerTransaction
    )
    expect(events).toEqual(['financial-transaction'])
  })

  it('checks the caller transaction before deleting and preserves removal authorization', async () => {
    selectResults.push([{ id: 'member-1', role: 'owner' }], [{ id: 'target-1', role: 'member' }])
    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/organizations/org-1/members/user-2', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'user-2' }) }
    )

    expect(response.status).toBe(200)
    expect(events).toEqual(['financial-transaction', 'leave-check', 'delete'])
    expect(mockAssertWorkspaceOwnerCanLeaveBillingOrganization).toHaveBeenCalledWith(
      { organizationId: 'org-1', workspaceOwnerId: 'user-2' },
      callerTransaction
    )
    expect(mockMutateOrganizationFinancialScope).toHaveBeenCalledWith(
      'org-1',
      expect.any(Function),
      { actorUserId: 'user-1', targetUserId: 'user-2', allowSelfRemoval: true }
    )
    expect(deleteMock).toHaveBeenCalledOnce()
    expect(globalDeleteMock).not.toHaveBeenCalled()
  })

  it('preserves a fresh authorization refusal before the callback guard or deletion', async () => {
    const { FinancialPolicyError } = await import('@tradinggoose/billing')
    selectResults.push([{ id: 'member-1', role: 'owner' }], [{ id: 'target-1', role: 'member' }])
    mockMutateOrganizationFinancialScope.mockRejectedValue(
      new FinancialPolicyError('Current organization administrator access required', 403)
    )
    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/organizations/org-1/members/user-2', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'user-2' }) }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Current organization administrator access required',
    })
    expect(mockAssertWorkspaceOwnerCanLeaveBillingOrganization).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(globalDeleteMock).not.toHaveBeenCalled()
  })

  it('keeps unauthenticated and owner-removal refusals before financial mutation', async () => {
    const { DELETE } = await import('./route')
    const request = () =>
      new NextRequest('http://localhost/api/organizations/org-1/members/user-2', {
        method: 'DELETE',
      })
    const params = { params: Promise.resolve({ id: 'org-1', memberId: 'user-2' }) }
    mockGetSession.mockResolvedValueOnce(null)
    expect((await DELETE(request(), params)).status).toBe(401)
    selectResults.push([{ id: 'member-1', role: 'owner' }], [{ id: 'target-1', role: 'owner' }])
    expect((await DELETE(request(), params)).status).toBe(400)
    expect(mockMutateOrganizationFinancialScope).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceOwnerCanLeaveBillingOrganization).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
