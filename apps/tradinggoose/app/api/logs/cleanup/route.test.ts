/**
 * @vitest-environment node
 */

vi.mock('@/lib/mastra/workflow-memory', () => ({
  cleanupOrphanWorkflowMemoryPage: vi.fn(async () => ({ scanned: 0, hasMore: false, nextPage: 0 })),
}))
vi.mock('@/lib/workflow-archive/lifecycle', () => ({
  prepareWorkflowArchive: (...args: unknown[]) => mockArchive(...args),
  ArchivePruneDeferredError: MockArchivePruneDeferredError,
  pruneArchivedWorkflowPayload: mockPrune,
  deleteArchivedWorkflowLog: mockSqlDelete,
}))

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockOrderHistoryTable,
  mockSelect,
  mockOldLogsWhere,
  mockOldLogsLimit,
  mockSnapshotCleanup,
  mockDeleteWhere,
  mockArchive,
  mockResolveBilling,
  mockTierRetention,
  mockPrune,
  mockSqlDelete,
  MockArchivePruneDeferredError,
} = vi.hoisted(() => {
  const mockOrderHistoryTable = {
    logId: 'orderHistoryTable.logId',
  }
  const mockOldLogsLimit = vi.fn()
  const mockOldLogsWhere = vi.fn(() => ({
    orderBy: vi.fn(() => ({ limit: mockOldLogsLimit })),
  }))
  const mockSelect = vi.fn()
  const mockSnapshotCleanup = vi.fn()
  const mockDeleteWhere = vi.fn()
  class MockArchivePruneDeferredError extends Error {}

  return {
    mockOrderHistoryTable,
    mockSelect,
    mockOldLogsWhere,
    mockOldLogsLimit,
    mockSnapshotCleanup,
    mockDeleteWhere,
    mockArchive: vi.fn(),
    mockResolveBilling: vi.fn(),
    mockTierRetention: vi.fn(),
    mockPrune: vi.fn(),
    mockSqlDelete: vi.fn(),
    MockArchivePruneDeferredError,
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
  gt: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gt', value })),
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
  getTierLogRetentionDays: mockTierRetention,
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: mockResolveBilling,
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
    mockSelect.mockReset()
    mockSelect
      .mockReturnValue({ from: vi.fn(() => ({ where: mockOldLogsWhere })) })
      .mockReturnValueOnce({
        from: vi.fn(async () => [
          {
            id: 'workspace-1',
            ownerId: 'user-1',
          },
        ]),
      })
    mockOldLogsLimit.mockReset().mockResolvedValue([])
    mockSnapshotCleanup.mockResolvedValue(0)
    mockArchive.mockResolvedValue({ digest: 'verified-private-digest' })
    mockPrune
      .mockReset()
      .mockRejectedValue(new MockArchivePruneDeferredError('Scoped writer settlement is unproved'))
    mockSqlDelete.mockReset()
    mockResolveBilling.mockReset().mockResolvedValue({ tier: 'free' })
    mockTierRetention.mockReset().mockReturnValue(30)
  })

  it('skips unproved log/output file references without delete contact while preserving archive retention', async () => {
    mockOldLogsLimit.mockResolvedValueOnce([
      {
        id: 'finished-log',
        executionId: 'execution-1',
        endedAt: new Date(0),
        files: [
          { key: 'copilot/private.png', sourceProof: 'not-delete-authority' },
          { key: 'old-flat.png', context: 'general', userId: 'caller' },
          { key: 'https://protected.example/file.png' },
        ],
      },
    ])
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('https://studio.example/api/logs/cleanup'))
    expect(response.status).toBe(200)
    expect((await response.json()).results).toMatchObject({
      files: { total: 3, deleted: 0, deleteFailed: 0, skippedUnverified: 3 },
      enhancedLogs: { archived: 1, pruneDeferred: 1, deleted: 0, archiveFailed: 0 },
    })
    const { StorageService } = await import('@/lib/uploads')
    expect(StorageService.deleteFile).not.toHaveBeenCalled()
    expect(mockArchive).toHaveBeenCalledWith('finished-log')
    expect(mockSqlDelete).not.toHaveBeenCalled()
    expect(mockSnapshotCleanup).toHaveBeenCalledOnce()
    const { pruneArchivedWorkflowPayload } = await import('@/lib/workflow-archive/lifecycle')
    expect(pruneArchivedWorkflowPayload).toHaveBeenCalledWith('finished-log')
  })

  it('reports deferred Memory cleanup while continuing log archive retention orchestration', async () => {
    const { cleanupOrphanWorkflowMemoryPage } = await import('@/lib/mastra/workflow-memory')
    vi.mocked(cleanupOrphanWorkflowMemoryPage).mockResolvedValueOnce({
      scanned: 1,
      hasMore: false,
      nextPage: 0,
      removed: 0,
      deferredOwners: 1,
    })
    mockOldLogsLimit.mockResolvedValueOnce([
      { id: 'finished-log', executionId: 'execution-1', endedAt: new Date(0), files: [] },
    ])
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
    expect(response.status).toBe(200)
    expect((await response.json()).memoryCleanup).toEqual({
      scanned: 1,
      hasMore: false,
      nextPage: 0,
      removed: 0,
      deferredOwners: 1,
    })
    expect(mockArchive).toHaveBeenCalledWith('finished-log')
    expect(mockSqlDelete).not.toHaveBeenCalled()
    expect(mockSnapshotCleanup).toHaveBeenCalledOnce()
    const { pruneArchivedWorkflowPayload } = await import('@/lib/workflow-archive/lifecycle')
    expect(pruneArchivedWorkflowPayload).toHaveBeenCalledWith('finished-log')
  })

  it('selects by durable workspace scope while excluding order-linked logs', async () => {
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
      const archived = mockArchive.mock.calls.map(([id]) => ({ id }))
      const expectedIds = parentFinished
        ? ['parent-log', 'finished-log', 'child-log']
        : ['finished-log']
      expect(archived.map((log) => log.id)).toEqual(expectedIds)
      expect(JSON.stringify(archived)).not.toContain('secret')
      const [where] = mockOldLogsWhere.mock.calls[0] as unknown as [unknown]
      const parentGuard = collectConditions(where).find(
        (guard) => guard.type === 'sql' && guard.strings.join('').includes('retention_parent')
      )
      expect(parentGuard?.strings.join('')).toContain("->'queuedExecution'->>'parentExecutionId'")
      expect(parentGuard?.strings.join('')).toContain("->>'source' = 'workflow_block'")
      expect(parentGuard?.strings.join('')).toContain('retention_parent.ended_at IS NULL')
      expect(mockSqlDelete).not.toHaveBeenCalled()
      expect((await response.json()).results.enhancedLogs).toMatchObject({
        archived: expectedIds.length,
        pruneDeferred: expectedIds.length,
        deleted: 0,
      })
    }
  )

  it('continues after preparation and prune errors, counting a verified archive before deferral', async () => {
    mockOldLogsLimit.mockResolvedValueOnce([
      { id: 'a-preparation-fails', files: [] },
      { id: 'b-prune-fails', files: [] },
      { id: 'c-deferred', files: [] },
    ])
    mockArchive.mockRejectedValueOnce(new Error('Private archive readback failed'))
    mockPrune.mockRejectedValueOnce(new Error('Archived source changed'))
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
    expect(response.status).toBe(200)
    expect((await response.json()).results.enhancedLogs).toEqual({
      total: 3,
      archived: 2,
      archiveFailed: 1,
      pruneDeferred: 1,
      deleted: 0,
      deleteFailed: 1,
    })
    expect(mockArchive.mock.calls.map(([id]) => id)).toEqual([
      'a-preparation-fails',
      'b-prune-fails',
      'c-deferred',
    ])
    expect(mockPrune.mock.calls.map(([id]) => id)).toEqual(['b-prune-fails', 'c-deferred'])
    expect(mockSqlDelete).not.toHaveBeenCalled()
    expect(mockSnapshotCleanup).toHaveBeenCalledOnce()
  })

  it('advances past a full deferred batch without recounting it or skipping snapshot cleanup', async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      id: `log-${String(index).padStart(4, '0')}`,
      files: [],
    }))
    mockOldLogsLimit.mockImplementation(async () => {
      const [where] = mockOldLogsWhere.mock.calls.at(-1) as unknown as [unknown]
      const cursor = collectConditions(where).find((condition) => condition.type === 'gt')
      return rows.filter((row) => !cursor || row.id > cursor.value).slice(0, 2000)
    })
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      results: { enhancedLogs: { total: 2000, archived: 2000, pruneDeferred: 2000, deleted: 0 } },
      complete: true,
      batchLimitReached: false,
    })
    expect(mockOldLogsLimit).toHaveBeenCalledTimes(2)
    expect(mockArchive).toHaveBeenCalledTimes(2000)
    expect(new Set(mockArchive.mock.calls.map(([id]) => id)).size).toBe(2000)
    expect(mockSqlDelete).not.toHaveBeenCalled()
    expect(mockSnapshotCleanup).toHaveBeenCalledOnce()
  })

  it('resets the sorted cursor for the next retention group, including lower log IDs', async () => {
    mockSelect
      .mockReset()
      .mockReturnValue({ from: vi.fn(() => ({ where: mockOldLogsWhere })) })
      .mockReturnValueOnce({
        from: vi.fn(async () => [
          { id: 'workspace-1', ownerId: 'user-1' },
          { id: 'workspace-2', ownerId: 'user-2' },
        ]),
      })
    mockTierRetention.mockReturnValueOnce(30).mockReturnValueOnce(7)
    const high = Array.from({ length: 2000 }, (_, index) => ({
      id: `z-${String(index).padStart(4, '0')}`,
      files: [],
    }))
    mockOldLogsLimit.mockImplementation(async () => {
      const [where] = mockOldLogsWhere.mock.calls.at(-1) as unknown as [unknown]
      const conditions = collectConditions(where)
      const group = conditions.find((condition) => condition.type === 'inArray')
      const cursor = conditions.find((condition) => condition.type === 'gt')
      const rows = group?.value.includes('workspace-1')
        ? high
        : [{ id: 'a-lower-next-group', files: [] }]
      return rows.filter((row) => !cursor || row.id > cursor.value).slice(0, 2000)
    })
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs/cleanup'))
    expect(response.status).toBe(200)
    expect((await response.json()).results.enhancedLogs).toMatchObject({
      total: 2001,
      archived: 2001,
      pruneDeferred: 2001,
    })
    expect(mockArchive).toHaveBeenCalledWith('a-lower-next-group')
    const [lastWhere] = mockOldLogsWhere.mock.calls.at(-1) as unknown as [unknown]
    expect(collectConditions(lastWhere).some((condition) => condition.type === 'gt')).toBe(false)
    expect(mockSqlDelete).not.toHaveBeenCalled()
    expect(mockSnapshotCleanup).toHaveBeenCalledOnce()
  })
})
