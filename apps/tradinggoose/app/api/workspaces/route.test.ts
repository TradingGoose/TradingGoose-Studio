/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
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
  const updateWhereMock = vi.fn()
  const updateSetMock = vi.fn()
  const updateMock = vi.fn()
  const mockSaveWorkflowToNormalizedTables = vi.fn()
  const mockApplyWorkflowState = vi.fn()
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
    updateWhereMock.mockResolvedValue([])
    updateSetMock.mockReturnValue({ where: updateWhereMock })
    updateMock.mockReturnValue({ set: updateSetMock })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mockApplyWorkflowState.mockResolvedValue(undefined)

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
        update: updateMock,
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
      ensureUniqueBlockIds: vi.fn(async (_workflowId: string, state: any) => state),
      ensureUniqueEdgeIds: vi.fn(async (_workflowId: string, state: any) => state),
      saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: mockApplyWorkflowState,
    }))

    vi.doMock('@/lib/yjs/workflow-session', () => ({
      createWorkflowSnapshot: vi.fn(() => ({})),
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

  it('returns an empty list without creating a default workspace when autoCreate=false', async () => {
    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET(new NextRequest('http://localhost/api/workspaces?autoCreate=false'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ workspaces: [] })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('lists existing workspaces without running workspace migration side effects when autoCreate=false', async () => {
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

    const response = await GET(new NextRequest('http://localhost/api/workspaces?autoCreate=false'))
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
    expect(updateMock).not.toHaveBeenCalled()
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

    const response = await GET(new NextRequest('http://localhost/api/workspaces?autoCreate=false'))
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

  it('auto-creates a default workspace with the canonical workspace shape', async () => {
    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET(new NextRequest('http://localhost/api/workspaces'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toEqual([
      expect.objectContaining({
        name: "Bruz's Workspace",
        role: 'owner',
        permissions: 'admin',
        billingOwner: {
          type: 'user',
          userId: 'user-1',
        },
      }),
    ])
    expect(transactionMock).toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalled()
  })

  it.each([
    [
      'persistence fails',
      () =>
        mockSaveWorkflowToNormalizedTables.mockResolvedValue({
          success: false,
          error: 'Failed to persist normalized workflow state',
        }),
    ],
    [
      'persistence throws',
      () => mockSaveWorkflowToNormalizedTables.mockRejectedValue(new Error('database unavailable')),
    ],
    [
      'Yjs seeding fails',
      () => mockApplyWorkflowState.mockRejectedValue(new Error('socket unavailable')),
    ],
  ])('removes a newly created workspace when default workflow %s', async (_case, fail) => {
    fail()
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
