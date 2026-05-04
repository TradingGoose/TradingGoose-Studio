/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'

describe('Workspaces API Route', () => {
  const transactionMock = vi.fn()
  const updateWhereMock = vi.fn()
  const updateSetMock = vi.fn()
  const updateMock = vi.fn()
  let sessionUserName: string | null = 'Bruz Gomez'
  const userWorkspacesQuery = {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => userWorkspaces),
        })),
      })),
    })),
  }
  const orphanedWorkflowsQuery = {
    from: vi.fn(() => ({
      where: vi.fn(() => []),
    })),
  }
  const insertedValues: Array<Record<string, unknown>> = []
  let userWorkspaces: Array<{
    workspace: Record<string, unknown>
    permissionType: 'admin' | 'write' | 'read'
  }> = []

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    userWorkspaces = []
    sessionUserName = 'Bruz Gomez'
    insertedValues.length = 0

    updateWhereMock.mockResolvedValue([])
    updateSetMock.mockReturnValue({ where: updateWhereMock })
    updateMock.mockReturnValue({ set: updateSetMock })
    transactionMock.mockImplementation(async (callback) => {
      await callback({
        insert: vi.fn((table) => ({
          values: vi.fn(async (values) => {
            insertedValues.push({
              table: String(table),
              ...(values as Record<string, unknown>),
            })
          }),
        })),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      })
    })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn((selection?: Record<string, unknown>) =>
          selection && 'workspace' in selection ? userWorkspacesQuery : orphanedWorkflowsQuery
        ),
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
        createdAt: 'workspace.createdAt',
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn(async () => ({
        user: {
          id: 'user-1',
          name: sessionUserName,
        },
      })),
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
      saveWorkflowToNormalizedTables: vi.fn().mockResolvedValue({ success: true }),
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      tryApplyWorkflowState: vi.fn().mockResolvedValue(undefined),
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

  it("personalizes the default workspace name from the user's first name", async () => {
    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET(new NextRequest('http://localhost/api/workspaces'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toHaveLength(1)
    expect(data.workspaces[0].name).toBe("Bruz's Workspace")
    expect(transactionMock).toHaveBeenCalled()
    expect(
      insertedValues.some(
        (values) =>
          values.description ===
            getPublicCopy('en').workspace.defaults.defaultWorkflowDescription &&
          values.name === 'default-agent'
      )
    ).toBe(true)
  })

  it('falls back to localized default workspace copy when no user name is available', async () => {
    sessionUserName = null
    const copy = getPublicCopy('es')
    const { GET } = await import('@/app/api/workspaces/route')

    const response = await GET(
      new NextRequest('http://localhost/api/workspaces', {
        headers: {
          'x-next-intl-locale': 'es',
        },
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toHaveLength(1)
    expect(data.workspaces[0].name).toBe(copy.workspace.defaults.newWorkspaceName)
  })
})
