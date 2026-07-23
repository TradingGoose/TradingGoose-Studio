/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const patchPermissions = async (body: unknown) => {
  const { PATCH } = await import('./route')
  return PATCH(
    new NextRequest('http://localhost/api/workspaces/workspace-1/permissions', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'workspace-1' }) }
  )
}

describe('Workspace permissions PATCH route', () => {
  const selectResults: any[][] = []
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = selectResults.shift() ?? []
        return {
          limit: vi.fn(() => rows),
          then: (
            onFulfilled: (value: any[]) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve(rows).then(onFulfilled, onRejected),
        }
      }),
    })),
  }))
  const updateWhereMock = vi.fn().mockResolvedValue(undefined)
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }))
  const updateMock = vi.fn(() => ({ set: updateSetMock }))
  const mockAssertActiveWorkspaceAccess = vi.fn()
  const mockGetUserEntityPermissions = vi.fn()
  const mockHasWorkspaceAdminAccess = vi.fn()
  const mockGetUsersWithPermissions = vi.fn()
  const mockAssertWorkspaceBillingOwnerRetainsAdminAccess = vi.fn()
  const mockRunYjsDrainFencedTransaction = vi.fn()
  const mockCreateSavedEntityErrorResponse = vi.fn()
  const workspaceRow = {
    ownerId: 'owner-1',
    billingOwnerType: 'user',
    billingOwnerUserId: 'owner-1',
  }
  const adminMember = { userId: 'user-1', permissionType: 'admin' }
  const targetMember = { userId: 'user-2', permissionType: 'read' }
  const queueFencedState = (members: unknown[], currentWorkspace = workspaceRow) => {
    selectResults.push([currentWorkspace], members)
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      permissionTypeEnum: {
        enumValues: ['admin', 'write', 'read'] as const,
      },
      permissions: {
        entityId: 'permissions.entityId',
        entityType: 'permissions.entityType',
        userId: 'permissions.userId',
        permissionType: 'permissions.permissionType',
        updatedAt: 'permissions.updatedAt',
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

    vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
      runYjsDrainFencedTransaction: mockRunYjsDrainFencedTransaction,
    }))

    vi.doMock('@/app/api/saved-entity-error-response', () => ({
      createSavedEntityErrorResponse: mockCreateSavedEntityErrorResponse,
    }))

    mockAssertActiveWorkspaceAccess.mockResolvedValue({})
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetUsersWithPermissions.mockResolvedValue([])
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockAssertWorkspaceBillingOwnerRetainsAdminAccess.mockImplementation(() => {})
    mockRunYjsDrainFencedTransaction.mockImplementation(
      async (_target: unknown, operation: (tx: unknown) => Promise<unknown>) =>
        operation({ select: selectMock, update: updateMock })
    )
    mockCreateSavedEntityErrorResponse.mockReturnValue(null)
  })

  it('blocks downgrading the billing owner from fenced state', async () => {
    mockAssertWorkspaceBillingOwnerRetainsAdminAccess.mockImplementation(() => {
      throw new Error('Workspace billing owner must retain admin permissions')
    })
    queueFencedState([adminMember, targetMember], {
      ...workspaceRow,
      billingOwnerUserId: 'user-2',
    })

    const response = await patchPermissions({
      updates: [{ userId: 'user-2', permissions: 'write' }],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace billing owner must retain admin permissions',
    })
    expect(mockRunYjsDrainFencedTransaction).toHaveBeenCalledOnce()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects empty, malformed, and duplicate permission updates before fencing', async () => {
    for (const body of [
      {},
      { updates: [] },
      {
        updates: [
          { userId: 'user-2', permissions: 'admin' },
          { userId: 'user-2', permissions: 'read' },
        ],
      },
    ]) {
      const response = await patchPermissions(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid permissions update payload' })
    }

    expect(mockRunYjsDrainFencedTransaction).not.toHaveBeenCalled()
    expect(mockAssertWorkspaceBillingOwnerRetainsAdminAccess).not.toHaveBeenCalled()
  })

  it('rejects updates to the current workspace owner inside the fence', async () => {
    queueFencedState([adminMember])

    const response = await patchPermissions({
      updates: [{ userId: 'owner-1', permissions: 'write' }],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace owner permissions are managed by workspace ownership',
    })
    expect(updateMock).not.toHaveBeenCalled()
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

  it('updates an existing permission in place for the current workspace owner', async () => {
    queueFencedState([targetMember], { ...workspaceRow, ownerId: 'user-1' })

    const response = await patchPermissions({
      updates: [{ userId: 'user-2', permissions: 'write' }],
    })

    expect(response.status).toBe(200)
    expect(mockRunYjsDrainFencedTransaction).toHaveBeenCalledWith(
      { workspaceIds: ['workspace-1'] },
      expect.any(Function)
    )
    expect(updateSetMock).toHaveBeenCalledWith({
      permissionType: 'write',
      updatedAt: expect.any(Date),
    })
    expect(updateWhereMock).toHaveBeenCalled()
  })

  it('rejects an actor whose admin access was revoked while waiting for the fence', async () => {
    queueFencedState([{ userId: 'user-1', permissionType: 'read' }, targetMember])

    const response = await patchPermissions({
      updates: [{ userId: 'user-2', permissions: 'write' }],
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Admin access required to update permissions',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not partially update when a target was removed while waiting for the fence', async () => {
    queueFencedState([adminMember, targetMember])

    const response = await patchPermissions({
      updates: [
        { userId: 'user-2', permissions: 'write' },
        { userId: 'removed-user', permissions: 'read' },
      ],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Workspace member not found' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not update permissions when the workspace disappeared while waiting', async () => {
    selectResults.push([])

    const response = await patchPermissions({
      updates: [{ userId: 'user-2', permissions: 'write' }],
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Workspace not found or access denied',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not touch fenced state when the workspace drain cannot be acquired', async () => {
    mockRunYjsDrainFencedTransaction.mockRejectedValueOnce(new Error('drain unavailable'))
    mockCreateSavedEntityErrorResponse.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'Realtime state is temporarily unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    )

    const response = await patchPermissions({
      updates: [{ userId: 'user-2', permissions: 'read' }],
    })

    expect(response.status).toBe(503)
    expect(selectMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })
})
