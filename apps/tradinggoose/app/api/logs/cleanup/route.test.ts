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
  mockArchive,
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
    mockArchive: vi.fn(),
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

vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: vi.fn(() => false),
  StorageService: {
    deleteFile: vi.fn(),
    uploadFile: mockArchive,
  },
}))

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
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn(async () => [
          {
            id: 'workspace-1',
            ownerId: 'user-1',
          },
        ]),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: mockOldLogsWhere,
        })),
      })
    mockOldLogsLimit.mockResolvedValue([])
    mockSnapshotCleanup.mockResolvedValue(0)
    mockArchive.mockResolvedValue({})
    mockDeleteReturning.mockResolvedValue([{ id: 'finished-log' }])
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
      const archived = mockArchive.mock.calls.map(([upload]) => JSON.parse(upload.file.toString()))
      const expectedIds = parentFinished
        ? ['parent-log', 'finished-log', 'child-log']
        : ['finished-log']
      expect(archived.map((log) => log.id)).toEqual(expectedIds)
      expect(JSON.stringify(archived)).not.toContain('secret')
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
})
