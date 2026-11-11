import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('workspace billing owner helpers', () => {
  const selectResults: any[][] = []
  const mockHasWorkspaceAdminAccess = vi.fn()
  const mockGetOrganizationSubscription = vi.fn()
  const mockIsOrganizationSubscription = vi.fn()
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
      },
      member: {
        id: 'member.id',
        userId: 'member.userId',
        organizationId: 'member.organizationId',
        role: 'member.role',
      },
      workspace: {
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
        billingOwnerType: 'workspace.billingOwnerType',
        billingOwnerUserId: 'workspace.billingOwnerUserId',
        billingOwnerOrganizationId: 'workspace.billingOwnerOrganizationId',
      },
      subscription: {
        id: 'subscription.id',
        referenceType: 'subscription.referenceType',
        referenceId: 'subscription.referenceId',
        status: 'subscription.status',
        cancelAtPeriodEnd: 'subscription.cancelAtPeriodEnd',
      },
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
    }))

    vi.doMock('@/lib/billing/core/billing', () => ({
      getOrganizationSubscription: mockGetOrganizationSubscription,
    }))

    vi.doMock('@/lib/billing/tiers', () => ({
      isOrganizationSubscription: mockIsOrganizationSubscription,
    }))

    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'subscription-1',
    })
    mockIsOrganizationSubscription.mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a user billing owner when the target user has workspace admin access', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    const { resolveWorkspaceBillingOwnerUpdate } = await import('./billing-owner')

    await expect(
      resolveWorkspaceBillingOwnerUpdate({
        actingUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workspaceOwnerId: 'owner-1',
        billingOwner: {
          type: 'user',
          userId: 'user-2',
        },
      })
    ).resolves.toEqual({
      billingOwnerType: 'user',
      billingOwnerUserId: 'user-2',
      billingOwnerOrganizationId: null,
    })

    expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-2', 'workspace-1')
  })

  it('rejects a user billing owner without workspace admin access', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    const { resolveWorkspaceBillingOwnerUpdate } = await import('./billing-owner')

    await expect(
      resolveWorkspaceBillingOwnerUpdate({
        actingUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workspaceOwnerId: 'owner-1',
        billingOwner: {
          type: 'user',
          userId: 'user-2',
        },
      })
    ).rejects.toThrow('Workspace billing owner user must have admin access')
  })

  it('resolves organization billing ownership when the workspace owner belongs to the org', async () => {
    selectResults.push([{ id: 'member-1' }], [{ id: 'workspace-1' }])
    const { resolveWorkspaceBillingOwnerUpdate } = await import('./billing-owner')

    await expect(
      resolveWorkspaceBillingOwnerUpdate({
        actingUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workspaceOwnerId: 'owner-1',
        billingOwner: {
          type: 'organization',
          organizationId: 'org-1',
        },
      })
    ).resolves.toEqual({
      billingOwnerType: 'organization',
      billingOwnerUserId: null,
      billingOwnerOrganizationId: 'org-1',
    })
  })

  it('rejects organization billing ownership when the workspace owner is not in the organization', async () => {
    selectResults.push([{ id: 'member-1' }], [])
    const { resolveWorkspaceBillingOwnerUpdate } = await import('./billing-owner')

    await expect(
      resolveWorkspaceBillingOwnerUpdate({
        actingUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workspaceOwnerId: 'owner-1',
        billingOwner: {
          type: 'organization',
          organizationId: 'org-1',
        },
      })
    ).rejects.toThrow('Workspace owner must belong to the billing organization')
  })

  it('rejects organization billing ownership when the organization has no active org tier', async () => {
    selectResults.push([{ id: 'member-1' }], [{ id: 'workspace-1' }])
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockIsOrganizationSubscription.mockReturnValue(false)
    const { resolveWorkspaceBillingOwnerUpdate } = await import('./billing-owner')

    await expect(
      resolveWorkspaceBillingOwnerUpdate({
        actingUserId: 'actor-1',
        workspaceId: 'workspace-1',
        workspaceOwnerId: 'owner-1',
        billingOwner: {
          type: 'organization',
          organizationId: 'org-1',
        },
      })
    ).rejects.toThrow(
      'Organization must have an active organization billing tier before workspaces can bill to it'
    )
  })

  it('blocks a workspace owner from leaving a billing organization while owning billed workspaces', async () => {
    selectResults.push([{ id: 'workspace-1' }])
    const { assertWorkspaceOwnerCanLeaveBillingOrganization } = await import('./billing-owner')

    await expect(
      assertWorkspaceOwnerCanLeaveBillingOrganization({
        organizationId: 'org-1',
        workspaceOwnerId: 'owner-1',
      })
    ).rejects.toThrow('Workspace owner must reassign billing before leaving the organization')
  })

  it('blocks deleting an organization while workspaces are still billed to it', async () => {
    selectResults.push([{ id: 'workspace-1' }])
    const { assertOrganizationCanBeDeleted } = await import('./billing-owner')

    await expect(assertOrganizationCanBeDeleted('org-1')).rejects.toThrow(
      'Cannot delete an organization while workspaces are billed to it'
    )
  })

  it('blocks deleting an organization while it still has a billing subscription', async () => {
    selectResults.push([])
    selectResults.push([{ id: 'subscription-1' }])
    const { assertOrganizationCanBeDeleted } = await import('./billing-owner')

    await expect(assertOrganizationCanBeDeleted('org-1')).rejects.toThrow(
      'Cannot delete an organization while it still has a billing subscription'
    )
  })

  it('blocks downgrading the workspace billing owner away from admin', async () => {
    const { assertWorkspaceBillingOwnerRetainsAdminAccess } = await import('./billing-owner')

    expect(() =>
      assertWorkspaceBillingOwnerRetainsAdminAccess({
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-2',
        updates: [{ userId: 'user-2', permissions: 'write' }],
      })
    ).toThrow('Workspace billing owner must retain admin permissions')
  })

  it('blocks removing the workspace billing owner from the workspace', async () => {
    const { assertWorkspaceBillingOwnerCanBeRemoved } = await import('./billing-owner')

    expect(() =>
      assertWorkspaceBillingOwnerCanBeRemoved({
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-2',
        userId: 'user-2',
      })
    ).toThrow('Cannot remove the workspace billing owner. Please reassign billing first.')
  })
})
