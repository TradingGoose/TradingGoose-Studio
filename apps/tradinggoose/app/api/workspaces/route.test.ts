/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workspaces API Route', () => {
  const transactionMock = vi.fn()
  const txInsertMock = vi.fn()
  let txInsertValues: Array<{ table: unknown; values: Record<string, unknown> }> = []
  let userWorkspaces: Array<{
    workspace: Record<string, unknown>
    permissionType: 'admin' | 'write' | 'read' | null
  }> = []

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    userWorkspaces = []
    txInsertValues = []
    txInsertMock.mockImplementation((table: unknown) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        txInsertValues.push({ table, values })
      }),
    }))
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ insert: txInsertMock })
    )

    vi.doMock('@tradinggoose/db', () => ({
      db: {
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
        insert: vi.fn(() => ({
          values: vi.fn().mockResolvedValue(undefined),
        })),
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      permissions: {
        permissionType: 'permissions.permissionType',
        userId: 'permissions.userId',
        entityType: 'permissions.entityType',
        entityId: 'permissions.entityId',
      },
      workspace: {
        table: 'workspace',
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
        createdAt: 'workspace.createdAt',
      },
      layoutMap: {
        table: 'layoutMap',
      },
      workflow: {
        table: 'workflow',
      },
      watchlistTable: {
        table: 'watchlistTable',
      },
      skill: {
        table: 'skill',
      },
      customTools: {
        table: 'customTools',
      },
      pineIndicators: {
        table: 'pineIndicators',
      },
      mcpServers: {
        table: 'mcpServers',
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

  it('creates a workspace with default dashboard entity documents in the same transaction', async () => {
    const { POST } = await import('@/app/api/workspaces/route')
    const schema = await import('@tradinggoose/db/schema')

    const response = await POST(
      new Request('http://localhost/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'Trading Desk' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspace).toMatchObject({
      name: 'Trading Desk',
      ownerId: 'user-1',
      permissions: 'admin',
    })
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txInsertValues.map((entry) => entry.table)).toEqual([
      schema.workspace,
      schema.workflow,
      schema.watchlistTable,
      schema.skill,
      schema.customTools,
      schema.pineIndicators,
      schema.mcpServers,
    ])

    const workspaceInsert = txInsertValues[0]?.values
    const documentValues = txInsertValues.slice(1).map((entry) => entry.values)

    expect(documentValues.map((values) => values.workspaceId)).toEqual(
      Array(6).fill(workspaceInsert.id)
    )
    expect(documentValues.map((values) => values.name ?? values.title)).toEqual([
      'Default Workflow',
      'Watchlist',
      'New Skill',
      'New Custom Tool',
      'New Indicator',
      'New MCP Server',
    ])
    expect(documentValues[1]).toMatchObject({ userId: null, parentId: null })
    expect(documentValues[5]).toMatchObject({ createdBy: 'user-1', enabled: false })
  })
})
