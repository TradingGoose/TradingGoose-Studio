/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks removing the workspace billing owner until billing is reassigned', async () => {
    selectResults.push([
      {
        billingOwnerType: 'user',
        billingOwnerUserId: 'user-2',
      },
    ])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/members/user-2', {
        method: 'DELETE',
        body: JSON.stringify({ workspaceId: 'workspace-1' }),
      }),
      { params: Promise.resolve({ id: 'user-2' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Cannot remove the workspace billing owner. Please reassign billing first.',
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(mockHasWorkspaceAdminAccess).not.toHaveBeenCalled()
  })
})
