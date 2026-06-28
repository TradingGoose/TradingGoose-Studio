/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workspaces API Route', () => {
  const transactionMock = vi.fn()
  const txInsertValuesMock = vi.fn()
  const txInsertMock = vi.fn(() => ({
    values: txInsertValuesMock,
  }))
  const deleteWhereMock = vi.fn()
  const deleteMock = vi.fn((_table: unknown) => ({
    where: deleteWhereMock,
  }))
  const mockSaveWorkflowToNormalizedTables = vi.fn()
  let userWorkspaces: Array<{
    workspace: Record<string, unknown>
    permissionType: 'admin' | 'write' | 'read' | null
  }> = []

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    userWorkspaces = []

    txInsertValuesMock.mockResolvedValue(undefined)
    transactionMock.mockImplementation(async (callback) =>
      callback({ insert: txInsertMock, delete: deleteMock })
    )
    deleteWhereMock.mockResolvedValue(undefined)
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        delete: deleteMock,
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => userWorkspaces),
              })),
            })),
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => userWorkspaces),
              })),
            })),
          })),
        })),
        transaction: transactionMock,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      permissions: {
        permissionType: 'permissions.permissionType',
        userId: 'permissions.userId',
        entityType: 'permissions.entityType',
        entityId: 'permissions.entityId',
      },
      workflow: {
        id: 'workflow.id',
        userId: 'workflow.userId',
        workspaceId: 'workflow.workspaceId',
      },
      workspace: {
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
        createdAt: 'workspace.createdAt',
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'user-1',
          name: 'Bruz',
        },
      }),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/workflows/defaults', () => ({
      buildDefaultWorkflowArtifacts: vi.fn(() => ({
        workflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      })),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
    }))

    vi.doMock('@/lib/workspaces/billing-owner', () => ({
      toWorkspaceApiRecord: vi.fn((workspace) => ({
        ...workspace,
        billingOwner: {
          type: workspace.billingOwnerType,
          ...(workspace.billingOwnerType === 'organization'
            ? { organizationId: workspace.billingOwnerOrganizationId }
            : { userId: workspace.billingOwnerUserId }),
        },
      })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function postWorkspace() {
    const { POST } = await import('@/app/api/workspaces/route')
    return POST(
      new Request('http://localhost/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Workspace' }),
      })
    )
  }

  it('returns an empty list without creating a default workspace during reads', async () => {
    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ workspaces: [] })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('lists existing workspaces without running migration side effects', async () => {
    userWorkspaces = [
      {
        workspace: {
          id: 'workspace-1',
          name: 'Admin Visible Workspace',
          ownerId: 'user-1',
          billingOwnerType: 'user',
          billingOwnerUserId: 'user-1',
          billingOwnerOrganizationId: null,
          createdAt: new Date('2026-04-09T00:00:00.000Z'),
          updatedAt: new Date('2026-04-09T00:00:00.000Z'),
        },
        permissionType: 'admin',
      },
    ]

    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toHaveLength(1)
    expect(data.workspaces[0]).toMatchObject({
      id: 'workspace-1',
      name: 'Admin Visible Workspace',
      billingOwner: {
        type: 'user',
        userId: 'user-1',
      },
      role: 'owner',
      permissions: 'admin',
    })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('lists owned workspaces without requiring an owner permission row', async () => {
    userWorkspaces = [
      {
        workspace: {
          id: 'workspace-owned',
          name: 'Owned Workspace',
          ownerId: 'user-1',
          billingOwnerType: 'user',
          billingOwnerUserId: 'user-1',
          billingOwnerOrganizationId: null,
          createdAt: new Date('2026-04-10T00:00:00.000Z'),
          updatedAt: new Date('2026-04-10T00:00:00.000Z'),
        },
        permissionType: null,
      },
    ]

    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toEqual([
      expect.objectContaining({
        id: 'workspace-owned',
        role: 'owner',
        permissions: 'admin',
      }),
    ])
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('removes a newly created workspace when default workflow state persistence fails', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({
      success: false,
      error: 'normalized state unavailable',
    })

    const response = await postWorkspace()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create workspace' })
    expect(deleteMock.mock.calls.map(([table]) => table)).toEqual([
      expect.objectContaining({ workspaceId: 'workflow.workspaceId' }),
      expect.objectContaining({ ownerId: 'workspace.ownerId' }),
    ])
    expect(deleteWhereMock).toHaveBeenCalledTimes(2)
  })
})
