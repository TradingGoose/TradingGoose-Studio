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
  const deleteMock = vi.fn()
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectResults.shift() ?? []),
      })),
    })),
  }))
  const mockHasWorkspaceAdminAccess = vi.fn()

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

    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
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
})
