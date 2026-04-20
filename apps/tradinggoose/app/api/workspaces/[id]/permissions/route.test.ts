/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workspace permissions PATCH route', () => {
  const selectResults: any[][] = []
  const transactionMock = vi.fn()
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))
  const mockHasWorkspaceAdminAccess = vi.fn()
  const mockGetUsersWithPermissions = vi.fn()
  const mockAssertWorkspaceBillingOwnerRetainsAdminAccess = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        transaction: transactionMock,
      },
      permissionTypeEnum: {
        enumValues: ['admin', 'write', 'read'] as const,
      },
      permissions: {
        entityId: 'permissions.entityId',
        entityType: 'permissions.entityType',
        userId: 'permissions.userId',
        permissionType: 'permissions.permissionType',
        createdAt: 'permissions.createdAt',
      },
      workspace: {
        id: 'workspace.id',
        billingOwnerType: 'workspace.billingOwnerType',
        billingOwnerUserId: 'workspace.billingOwnerUserId',
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

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUsersWithPermissions: mockGetUsersWithPermissions,
      hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
    }))

    vi.doMock('../../../../../lib/workspaces/billing-owner', () => ({
      assertWorkspaceBillingOwnerRetainsAdminAccess:
        mockAssertWorkspaceBillingOwnerRetainsAdminAccess,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks downgrading the billing owner user away from admin', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockGetUsersWithPermissions.mockResolvedValue([])
    mockAssertWorkspaceBillingOwnerRetainsAdminAccess.mockImplementation(() => {
      throw new Error('Workspace billing owner must retain admin permissions')
    })
    selectResults.push(
      [{ id: 'permission-1' }],
      [
        {
          billingOwnerType: 'user',
          billingOwnerUserId: 'user-2',
        },
      ]
    )

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/permissions', {
        method: 'PATCH',
        body: JSON.stringify({
          updates: [{ userId: 'user-2', permissions: 'write' }],
        }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace billing owner must retain admin permissions',
    })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceBillingOwnerRetainsAdminAccess).toHaveBeenCalled()
  })

  it('rejects malformed permission updates before touching the database', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockGetUsersWithPermissions.mockResolvedValue([])
    selectResults.push(
      [{ id: 'permission-1' }],
      [{ billingOwnerType: 'user', billingOwnerUserId: 'user-2' }]
    )

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/permissions', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid permissions update payload',
    })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceBillingOwnerRetainsAdminAccess).not.toHaveBeenCalled()
  })
})
