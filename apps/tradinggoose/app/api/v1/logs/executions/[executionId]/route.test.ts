/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))

  return {
    chain,
    checkRateLimit: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getUserLimits: vi.fn(),
    select: vi.fn(() => chain),
    selectQueue,
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
    workspaceId: 'workflow.workspaceId',
  },
  workflowExecutionLogs: {
    executionId: 'workflowExecutionLogs.executionId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
  },
  workflowExecutionSnapshots: {
    id: 'workflowExecutionSnapshots.id',
    workspaceId: 'workflowExecutionSnapshots.workspaceId',
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
  createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  createApiResponse: vi.fn((body) => ({ body, headers: {} })),
  getUserLimits: (...args: unknown[]) => mocks.getUserLimits(...args),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: (...args: unknown[]) => mocks.checkRateLimit(...args),
  createRateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}))

describe('v1 execution route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mocks.getUserLimits.mockResolvedValue({})
  })

  it('uses detached log workspace permission and scopes snapshot lookup to the log workspace', async () => {
    mocks.selectQueue.push([
      {
        log: {
          workflowId: null,
          workflowSummary: { id: 'deleted-workflow-1' },
          workspaceId: 'workspace-1',
          stateSnapshotId: 'snapshot-1',
          trigger: 'manual',
          startedAt: new Date('2026-04-23T00:00:00.000Z'),
          endedAt: null,
          totalDurationMs: null,
          cost: null,
        },
        workflow: null,
      },
    ])
    mocks.selectQueue.push([{ stateData: { blocks: {} } }])
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/v1/logs/executions/exec-1'), {
      params: Promise.resolve({ executionId: 'exec-1' }),
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
    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionSnapshots.workspaceId', 'workspace-1')
    expect(await response.json()).toMatchObject({
      workflowId: 'deleted-workflow-1',
      workflowState: { blocks: {} },
    })
  })
})
