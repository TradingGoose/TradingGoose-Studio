/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))

  return {
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getSession: vi.fn(),
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
    id: 'permissions.id',
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  workflowExecutionLogs: {
    executionId: 'workflowExecutionLogs.executionId',
    stateSnapshotId: 'workflowExecutionLogs.stateSnapshotId',
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
  workflowExecutionSnapshots: {
    id: 'workflowExecutionSnapshots.id',
    workspaceId: 'workflowExecutionSnapshots.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

describe('logs execution route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('rejects unauthenticated execution snapshot access', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/logs/execution/exec-1'), {
      params: Promise.resolve({ executionId: 'exec-1' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects execution snapshot access without workspace permission', async () => {
    mocks.selectQueue.push([
      {
        executionId: 'exec-1',
        stateSnapshotId: 'snapshot-1',
        workflowId: null,
        workflowSummary: { id: 'deleted-workflow-1' },
        workspaceId: 'workspace-1',
      },
    ])
    mocks.selectQueue.push([])
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/logs/execution/exec-1'), {
      params: Promise.resolve({ executionId: 'exec-1' }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(mocks.eq).toHaveBeenCalledWith('permissions.entityId', 'workspace-1')
    expect(mocks.eq).toHaveBeenCalledWith('permissions.userId', 'user-1')
  })

  it('scopes snapshot lookup to the authorized log workspace', async () => {
    mocks.selectQueue.push([
      {
        executionId: 'exec-1',
        stateSnapshotId: 'snapshot-1',
        workflowId: null,
        workflowSummary: { id: 'deleted-workflow-1' },
        workspaceId: 'workspace-1',
      },
    ])
    mocks.selectQueue.push([{ id: 'permission-1' }])
    mocks.selectQueue.push([{ stateData: { blocks: { block1: { id: 'block1' } } } }])
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/logs/execution/exec-1'), {
      params: Promise.resolve({ executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionSnapshots.workspaceId', 'workspace-1')
    expect(await response.json()).toEqual({
      workflowId: 'deleted-workflow-1',
      workflowState: { blocks: { block1: { id: 'block1' } } },
    })
  })
})
