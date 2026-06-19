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
  const mockAssertActiveWorkspaceAccess = vi.fn()
  const mockGetUserEntityPermissions = vi.fn()
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
        ownerId: 'workspace.ownerId',
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
      assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
      getUserEntityPermissions: mockGetUserEntityPermissions,
      getUsersWithPermissions: mockGetUsersWithPermissions,
      hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
    }))

    vi.doMock('../../../../../lib/workspaces/billing-owner', () => ({
      assertWorkspaceBillingOwnerRetainsAdminAccess:
        mockAssertWorkspaceBillingOwnerRetainsAdminAccess,
    }))

    mockAssertActiveWorkspaceAccess.mockResolvedValue({})
    mockGetUserEntityPermissions.mockResolvedValue('admin')
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
          ownerId: 'owner-1',
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
      [{ ownerId: 'owner-1', billingOwnerType: 'user', billingOwnerUserId: 'user-2' }]
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

  it('rejects updates to the canonical workspace owner permission', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    selectResults.push([
      {
        ownerId: 'owner-1',
        billingOwnerType: 'organization',
        billingOwnerUserId: null,
      },
    ])

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/permissions', {
        method: 'PATCH',
        body: JSON.stringify({
          updates: [{ userId: 'owner-1', permissions: 'write' }],
        }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace owner permissions are managed by workspace ownership',
    })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceBillingOwnerRetainsAdminAccess).not.toHaveBeenCalled()
  })

  it('resolves the current user permission independently from the member list', async () => {
    mockGetUsersWithPermissions.mockResolvedValue([])
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/workspaces/workspace-1/permissions'),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      users: [],
      total: 0,
      currentUserPermission: 'admin',
    })
    expect(mockAssertActiveWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'workspace-1')
  })
})
