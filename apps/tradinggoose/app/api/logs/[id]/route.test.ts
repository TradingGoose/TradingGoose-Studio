/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockLimit,
  mockWhere,
  mockInnerJoin,
  mockLeftJoin,
  mockFrom,
  mockSelect,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockLimit = vi.fn()
  const chain: Record<string, any> = {}
  const mockWhere = vi.fn(() => chain)
  const mockInnerJoin = vi.fn(() => chain)
  const mockLeftJoin = vi.fn(() => chain)
  const mockFrom = vi.fn(() => chain)
  Object.assign(chain, {
    innerJoin: mockInnerJoin,
    leftJoin: mockLeftJoin,
    where: mockWhere,
    limit: mockLimit,
  })
  const mockSelect = vi.fn(() => ({
    from: mockFrom,
  }))

  return {
    mockGetSession,
    mockLimit,
    mockWhere,
    mockInnerJoin,
    mockLeftJoin,
    mockFrom,
    mockSelect,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
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
    name: 'workflow.name',
    description: 'workflow.description',
    color: 'workflow.color',
    folderId: 'workflow.folderId',
    userId: 'workflow.userId',
    createdAt: 'workflow.createdAt',
    updatedAt: 'workflow.updatedAt',
  },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workflowId: 'workflowExecutionLogs.workflowId',
    executionId: 'workflowExecutionLogs.executionId',
    level: 'workflowExecutionLogs.level',
    trigger: 'workflowExecutionLogs.trigger',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    executionData: 'workflowExecutionLogs.executionData',
    cost: 'workflowExecutionLogs.cost',
    files: 'workflowExecutionLogs.files',
    createdAt: 'workflowExecutionLogs.createdAt',
  },
  workflowFolder: {
    id: 'workflowFolder.id',
    name: 'workflowFolder.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const buildRow = ({ startedAt = new Date('2026-04-23T00:00:00.000Z') }: { startedAt?: Date | null }) => ({
  id: 'log-1',
  workflowId: 'workflow-1',
  executionId: 'exec-1',
  level: 'info',
  trigger: 'manual',
  startedAt,
  endedAt: new Date('2026-04-23T00:05:00.000Z'),
  totalDurationMs: 300000,
  executionData: {
    blockExecutions: [
      {
        id: 'block-execution-1',
        blockId: 'block-1',
        blockName: 'Fetch Bars',
        blockType: 'http',
        startedAt: '2026-04-23T00:00:00.000Z',
        endedAt: '2026-04-23T00:05:00.000Z',
        durationMs: 300000,
        status: 'success',
        inputData: { symbol: 'AAPL' },
        outputData: { rows: 42 },
        metadata: {},
      },
    ],
  },
  cost: null,
  files: null,
  createdAt: new Date('2026-04-23T00:00:00.000Z'),
  workflowName: 'Workflow Alpha',
  workflowDescription: null,
  workflowColor: '#3972F6',
  workflowFolderId: 'folder-1',
  workflowFolderName: 'Alpha Desk',
  workflowUserId: 'user-1',
  workflowWorkspaceId: 'workspace-1',
  workflowCreatedAt: new Date('2026-04-22T00:00:00.000Z'),
  workflowUpdatedAt: new Date('2026-04-23T00:00:00.000Z'),
})

const expectWorkflowJoinedBeforeFolder = () => {
  const fromCall = mockFrom.mock.calls.at(-1) as [unknown] | undefined

  expect(fromCall?.[0]).toMatchObject({
    id: 'workflow.id',
  })
  expect(mockInnerJoin.mock.invocationCallOrder[0]).toBeLessThan(
    mockLeftJoin.mock.invocationCallOrder[0]!
  )
}

describe('log detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockLimit.mockResolvedValue([buildRow({})])
  })

  it('rejects unauthorized access', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/log-1'), {
      params: Promise.resolve({ id: 'log-1' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('serializes canonical durationMs without the legacy executionData alias', async () => {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/log-1'), {
      params: Promise.resolve({ id: 'log-1' }),
    })

    expect(response.status).toBe(200)
    expectWorkflowJoinedBeforeFolder()
    const body = await response.json()

    expect(body).toEqual({
      data: expect.objectContaining({
        durationMs: 300000,
        executionData: expect.not.objectContaining({
          totalDuration: expect.anything(),
        }),
      }),
    })
    expect(body.data.createdAt).toBeUndefined()
    expect(body.data.executionData.traceSpans).toEqual([
      expect.objectContaining({
        id: 'block-execution-1',
        blockId: 'block-1',
        name: 'Fetch Bars',
      }),
    ])
  })

  it('fails instead of falling back to createdAt when startedAt is missing', async () => {
    mockLimit.mockResolvedValue([buildRow({ startedAt: null })])
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/log-1'), {
      params: Promise.resolve({ id: 'log-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Workflow log log-1 is missing startedAt',
    })
  })
})
