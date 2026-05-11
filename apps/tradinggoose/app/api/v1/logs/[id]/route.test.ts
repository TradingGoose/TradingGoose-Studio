/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectRows = vi.fn()
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(selectRows()))

  return {
    chain,
    checkRateLimit: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getUserLimits: vi.fn(),
    select: vi.fn(() => chain),
    selectRows,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  permissions: {
    entityType: 'permissions.entityType',
    entityId: 'permissions.entityId',
    userId: 'permissions.userId',
  },
  workflow: {
    id: 'workflow.id',
    name: 'workflow.name',
    description: 'workflow.description',
    color: 'workflow.color',
    folderId: 'workflow.folderId',
    userId: 'workflow.userId',
    workspaceId: 'workflow.workspaceId',
    createdAt: 'workflow.createdAt',
    updatedAt: 'workflow.updatedAt',
  },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workflowId: 'workflowExecutionLogs.workflowId',
    executionId: 'workflowExecutionLogs.executionId',
    stateSnapshotId: 'workflowExecutionLogs.stateSnapshotId',
    level: 'workflowExecutionLogs.level',
    trigger: 'workflowExecutionLogs.trigger',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    executionData: 'workflowExecutionLogs.executionData',
    cost: 'workflowExecutionLogs.cost',
    files: 'workflowExecutionLogs.files',
    createdAt: 'workflowExecutionLogs.createdAt',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: mocks.eq,
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  createApiResponse: vi.fn((body) => ({ body, headers: {} })),
  getUserLimits: (...args: unknown[]) => mocks.getUserLimits(...args),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: (...args: unknown[]) => mocks.checkRateLimit(...args),
  createRateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}))

describe('v1 log detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mocks.getUserLimits.mockResolvedValue({})
    mocks.selectRows.mockReturnValue([
      {
        id: 'log-1',
        workflowId: null,
        executionId: 'execution-1',
        stateSnapshotId: 'snapshot-1',
        level: 'info',
        trigger: 'manual',
        startedAt: new Date('2026-04-23T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: {},
        cost: null,
        files: null,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        workspaceId: 'workspace-1',
        workflowSummary: {
          id: 'deleted-workflow-1',
          name: 'Deleted workflow',
          workspaceId: 'workspace-1',
        },
        workflowName: null,
        workflowDescription: null,
        workflowColor: null,
        workflowFolderId: null,
        workflowUserId: null,
        workflowWorkspaceId: null,
        workflowCreatedAt: null,
        workflowUpdatedAt: null,
      },
    ])
  })

  it('uses log workspace permission and persisted workflow summary for detached logs', async () => {
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/v1/logs/log-1'), {
      params: Promise.resolve({ id: 'log-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.chain.leftJoin).toHaveBeenCalled()
    expect(mocks.chain.innerJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace.id',
        ownerId: 'workspace.ownerId',
      }),
      {
        field: 'workspace.id',
        type: 'eq',
        value: 'workflowExecutionLogs.workspaceId',
      }
    )
    expect(mocks.eq).toHaveBeenCalledWith(
      'permissions.entityId',
      'workflowExecutionLogs.workspaceId'
    )
    expect(mocks.eq).toHaveBeenCalledWith('workspace.ownerId', 'user-1')
    expect(await response.json()).toMatchObject({
      data: {
        workflowId: 'deleted-workflow-1',
        workflow: {
          id: 'deleted-workflow-1',
          name: 'Deleted workflow',
          workspaceId: 'workspace-1',
        },
      },
    })
  })
})
