/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockOrderHistoryTable,
  mockSelect,
  mockOldLogsWhere,
  mockOldLogsLimit,
  mockSnapshotCleanup,
  mockDeleteWhere,
  mockDeleteReturning,
  mockNativeCleanup,
  mockDeleteFile,
} = vi.hoisted(() => {
  const mockOrderHistoryTable = {
    logId: 'orderHistoryTable.logId',
  }
  const mockOldLogsLimit = vi.fn()
  const mockOldLogsWhere = vi.fn(() => ({
    limit: mockOldLogsLimit,
  }))
  const mockSelect = vi.fn()
  const mockSnapshotCleanup = vi.fn()
  const mockDeleteReturning = vi.fn()
  const mockDeleteWhere = vi.fn((_condition: unknown) => ({ returning: mockDeleteReturning }))

  return {
    mockOrderHistoryTable,
    mockSelect,
    mockOldLogsWhere,
    mockOldLogsLimit,
    mockSnapshotCleanup,
    mockDeleteWhere,
    mockDeleteReturning,
    mockNativeCleanup: vi.fn(),
    mockDeleteFile: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
  },
  orderHistoryTable: mockOrderHistoryTable,
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
  workflowExecutionLogs: {
    cost: 'workflowExecutionLogs.cost',
    createdAt: 'workflowExecutionLogs.createdAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    executionData: 'workflowExecutionLogs.executionData',
    executionId: 'workflowExecutionLogs.executionId',
    files: 'workflowExecutionLogs.files',
    id: 'workflowExecutionLogs.id',
    level: 'workflowExecutionLogs.level',
    startedAt: 'workflowExecutionLogs.startedAt',
    stateSnapshotId: 'workflowExecutionLogs.stateSnapshotId',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    trigger: 'workflowExecutionLogs.trigger',
    workflowId: 'workflowExecutionLogs.workflowId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
  workflowLogWebhookDelivery: {
    executionId: 'workflowLogWebhookDelivery.executionId',
    status: 'workflowLogWebhookDelivery.status',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'inArray',
    value,
  })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lt', value })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: vi.fn(() => null),
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: vi.fn(async () => true),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getTierLogRetentionDays: vi.fn(() => 30),
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: vi.fn(async () => ({ tier: 'free' })),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {
    cleanupOrphanedSnapshots: mockSnapshotCleanup,
  },
}))

vi.mock('@/lib/mastra/agent-history', () => ({ deleteAgentHistory: mockNativeCleanup }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))

const collectConditions = (value: unknown): Array<Record<string, any>> => {
  if (!value || typeof value !== 'object') {
    return []
  }

  const condition = value as Record<string, any>
  const nested =
    condition.type === 'and' && Array.isArray(condition.conditions)
      ? condition.conditions.flatMap((entry: unknown) => collectConditions(entry))
      : []

  return [condition, ...nested]
}

describe('logs cleanup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockImplementation((fields) => ({
      from: () =>
        fields.id === 'workspace.id'
          ? Promise.resolve([{ id: 'workspace-1', ownerId: 'user-1' }])
          : { where: mockOldLogsWhere },
    }))
    mockOldLogsLimit.mockReset().mockResolvedValue([])
    mockSnapshotCleanup.mockResolvedValue(0)
    mockNativeCleanup.mockReset().mockResolvedValue(undefined)
    mockDeleteFile.mockReset().mockResolvedValue(undefined)
    mockDeleteReturning.mockReset().mockResolvedValue([{ id: 'finished-log' }])
  })

  it('deletes by durable workspace scope while excluding order-linked logs', async () => {
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))

    expect(response.status).toBe(200)
    const whereCalls = mockOldLogsWhere.mock.calls as unknown as Array<[unknown]>
    const conditions = collectConditions(whereCalls[0]?.[0])

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'isNotNull' && condition.field === 'workflowExecutionLogs.endedAt'
      )
    ).toBe(true)
    expect(
      conditions.some(
        (condition) =>
          condition.type === 'inArray' &&
          condition.field === 'workflowExecutionLogs.workspaceId' &&
          condition.value.includes('workspace-1')
      )
    ).toBe(true)
    expect(
      conditions.some(
        (condition) =>
          condition.type === 'sql' &&
          condition.strings?.join('').includes('NOT EXISTS') &&
          condition.values?.includes(mockOrderHistoryTable) &&
          condition.values?.includes('orderHistoryTable.logId') &&
          condition.values?.includes('workflowExecutionLogs.id')
      )
    ).toBe(true)
  })

  it.each([false, true])(
    'retains active logs and their finished children until parent completion (%s)',
    async (parentFinished) => {
      const candidates: Array<Record<string, any>> = [
        {
          id: 'paused-log',
          endedAt: null,
          executionData: { checkpoint: { encryptedSnapshot: 'secret' } },
        },
        {
          id: 'parent-log',
          executionId: 'parent-execution',
          endedAt: parentFinished ? new Date('2020-01-01') : null,
          executionData: {},
        },
        { id: 'finished-log', endedAt: new Date('2020-01-01'), executionData: {} },
        {
          id: 'child-log',
          endedAt: new Date('2020-01-01'),
          executionData: {
            trigger: {
              data: {
                queuedExecution: {
                  source: 'workflow_block',
                  parentExecutionId: 'parent-execution',
                },
              },
            },
          },
        },
      ]
      mockOldLogsLimit.mockImplementation(async () => {
        const [where] = mockOldLogsWhere.mock.calls[0] as unknown as [unknown]
        const guards = collectConditions(where)
        return candidates.filter((row) =>
          guards.every((guard) => {
            if (guard.type === 'isNotNull') return row[guard.field.split('.').at(-1)] != null
            if (guard.type === 'sql' && guard.strings.join('').includes('retention_parent')) {
              const queued = row.executionData.trigger?.data?.queuedExecution
              return (
                queued?.source !== 'workflow_block' ||
                !candidates.some(
                  (parent) =>
                    parent.executionId === queued.parentExecutionId && parent.endedAt === null
                )
              )
            }
            return true
          })
        )
      })
      const { GET } = await import('./route')

      const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))

      expect(response.status).toBe(200)
      const removed = mockNativeCleanup.mock.calls.map(([log]) => log)
      const expectedIds = parentFinished
        ? ['parent-log', 'finished-log', 'child-log']
        : ['finished-log']
      expect(removed.map((log) => log.id)).toEqual(expectedIds)
      expect(JSON.stringify(removed)).not.toContain('secret')
      for (const [index, [where]] of mockDeleteWhere.mock.calls.entries()) {
        const deleteConditions = collectConditions(where)
        expect(deleteConditions).toEqual(
          expect.arrayContaining([
            { type: 'eq', field: 'workflowExecutionLogs.id', value: expectedIds[index] },
            { type: 'isNotNull', field: 'workflowExecutionLogs.endedAt' },
          ])
        )
        const parentGuard = deleteConditions.find(
          (guard) => guard.type === 'sql' && guard.strings.join('').includes('retention_parent')
        )
        expect(parentGuard?.strings.join('')).toContain("->'queuedExecution'->>'parentExecutionId'")
        expect(parentGuard?.strings.join('')).toContain("->>'source' = 'workflow_block'")
        expect(parentGuard?.strings.join('')).toContain('retention_parent.ended_at IS NULL')
      }
      expect((await response.json()).results.enhancedLogs.deleted).toBe(expectedIds.length)
    }
  )

  it.each(['file', 'history', 'log'])(
    'retains cleanup ownership after a %s failure and retries next run',
    async (failure) => {
      const key = 'workspace-1/workflow-1/execution-1/report.pdf'
      const log = {
        id: 'finished-log',
        workspaceId: 'workspace-1',
        workflowId: null,
        executionId: 'execution-1',
        endedAt: new Date('2020-01-01'),
        files: [
          { key },
          { key },
          { key: 'workspace-1/123-input.pdf' },
          { key: 'workspace-1/workflow-1/other-execution/shared.pdf' },
          { key: 'other-workspace/workflow-1/execution-1/shared.pdf' },
          { key: 'kb/input.pdf' },
        ],
      }
      let retained = true
      mockOldLogsLimit.mockImplementation(async () => (retained ? [log] : []))
      mockDeleteReturning.mockImplementation(async () => {
        retained = false
        return [{ id: log.id }]
      })
      const unavailable = new Error('Temporary cleanup outage')
      if (failure === 'file') mockDeleteFile.mockRejectedValueOnce(unavailable)
      if (failure === 'history') mockNativeCleanup.mockRejectedValueOnce(unavailable)
      if (failure === 'log') mockDeleteReturning.mockRejectedValueOnce(unavailable)
      const { GET } = await import('./route')
      const first = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
      const failed = await first.json()
      expect(failed.results.enhancedLogs).toMatchObject({ deleted: 0, deleteFailed: 1 })
      expect(failed.complete).toBe(false)
      expect(retained).toBe(true)
      if (failure !== 'log') expect(mockDeleteReturning).not.toHaveBeenCalled()
      if (failure === 'file') expect(mockNativeCleanup).not.toHaveBeenCalled()

      const second = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
      const finished = await second.json()
      expect(finished.results.enhancedLogs).toMatchObject({ deleted: 1, deleteFailed: 0 })
      expect(finished.complete).toBe(true)
      expect(retained).toBe(false)
      expect(mockDeleteFile.mock.calls).toEqual([
        [{ key, context: 'execution' }],
        [{ key, context: 'execution' }],
      ])
      expect(mockNativeCleanup).toHaveBeenLastCalledWith(log)
    }
  )
})
