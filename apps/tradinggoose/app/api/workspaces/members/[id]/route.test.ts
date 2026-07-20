/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function deleteMember(userId: string) {
  const { DELETE } = await import('./route')
  return DELETE(
    new NextRequest(`http://localhost/api/workspaces/members/${userId}`, {
      method: 'DELETE',
      body: JSON.stringify({ workspaceId: 'workspace-1' }),
    }),
    { params: Promise.resolve({ id: userId }) }
  )
}

describe('Workspace member DELETE route', () => {
  const selectResults: any[][] = []
  const deleteWhereMock = vi.fn()
  const deleteMock = vi.fn(() => ({
    where: deleteWhereMock,
  }))
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
  const mockHasWorkspaceAdminAccess = vi.fn()
  const mockWithYjsSessionDrainLease = vi.fn()
  const mockRunYjsDrainFencedTransaction = vi.fn()
  const mockCreateSavedEntityErrorResponse = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectResults.length = 0

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        delete: deleteMock,
      },
      permissions: {
        userId: 'permissions.userId',
        entityType: 'permissions.entityType',
        entityId: 'permissions.entityId',
        permissionType: 'permissions.permissionType',
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
        error: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
    }))

    vi.doMock('@/lib/workspaces/billing-owner', () => ({
      assertWorkspaceBillingOwnerCanBeRemoved: vi.fn(
        ({ billingOwnerType, billingOwnerUserId, userId }: Record<string, string | null>) => {
          if (billingOwnerType === 'user' && billingOwnerUserId === userId) {
            throw new Error(
              'Cannot remove the workspace billing owner. Please reassign billing first.'
            )
          }
        }
      ),
    }))

    vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
      withYjsSessionDrainLease: mockWithYjsSessionDrainLease,
      runYjsDrainFencedTransaction: mockRunYjsDrainFencedTransaction,
    }))

    vi.doMock('@/app/api/saved-entity-error-response', () => ({
      createSavedEntityErrorResponse: mockCreateSavedEntityErrorResponse,
    }))

    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockWithYjsSessionDrainLease.mockImplementation(
      async (_target: unknown, operation: (lease: unknown) => Promise<unknown>) =>
        operation({ assertHeld: vi.fn() })
    )
    mockRunYjsDrainFencedTransaction.mockImplementation(
      async (_leases: unknown, operation: (tx: unknown) => Promise<unknown>) =>
        operation({ delete: deleteMock })
    )
    mockCreateSavedEntityErrorResponse.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks removing the workspace billing owner until billing is reassigned', async () => {
    selectResults.push([
      {
        ownerId: 'user-1',
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-2',
      },
    ])
    const response = await deleteMember('user-2')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Cannot remove the workspace billing owner. Please reassign billing first.',
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('blocks removing the canonical workspace owner', async () => {
    selectResults.push([
      {
        ownerId: 'user-2',
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-1',
      },
    ])

    const response = await deleteMember('user-2')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot remove the workspace owner' })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('does not disclose canonical owner state to callers without admin access', async () => {
    mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    selectResults.push([
      {
        ownerId: 'user-2',
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-1',
      },
    ])

    const response = await deleteMember('user-2')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Insufficient permissions' })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('allows a non-owner admin to leave when the canonical owner remains admin', async () => {
    selectResults.push([
      {
        ownerId: 'owner-1',
        billingOwnerType: 'user',
        billingOwnerUserId: 'owner-1',
      },
    ])
    selectResults.push([{ userId: 'user-1', permissionType: 'admin' }])

    const response = await deleteMember('user-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockWithYjsSessionDrainLease).toHaveBeenCalledWith(
      { workspaceIds: ['workspace-1'] },
      expect.any(Function)
    )
    expect(mockRunYjsDrainFencedTransaction).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalledWith(expect.anything())
    expect(deleteWhereMock).toHaveBeenCalled()
  })

  it('does not remove the member when the workspace drain cannot be acquired', async () => {
    selectResults.push(
      [
        {
          ownerId: 'owner-1',
          billingOwnerType: 'user',
          billingOwnerUserId: 'owner-1',
        },
      ],
      [{ userId: 'user-2', permissionType: 'write' }]
    )
    mockWithYjsSessionDrainLease.mockRejectedValueOnce(new Error('drain unavailable'))
    mockCreateSavedEntityErrorResponse.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'Realtime state is temporarily unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    )

    const response = await deleteMember('user-2')

    expect(response.status).toBe(503)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockRunYjsDrainFencedTransaction).not.toHaveBeenCalled()
  })
})
