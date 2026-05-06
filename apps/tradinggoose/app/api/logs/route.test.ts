/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockLimit,
  mockOffset,
  mockWhere,
  mockInnerJoin,
  mockLeftJoin,
  mockFrom,
  mockSelect,
  setMockRows,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  let rows: any[] = []
  const chain: Record<string, any> = {}
  const setMockRows = (nextRows: any[]) => {
    rows = nextRows
  }
  const mockLimit = vi.fn((_limit: unknown) => chain)
  const mockOffset = vi.fn((_offset: unknown) => Promise.resolve(rows))
  const mockOrderBy = vi.fn((..._orderBy: unknown[]) => chain)
  const mockWhere = vi.fn((_condition: unknown) => chain)
  const mockInnerJoin = vi.fn((_table: unknown, _condition: unknown) => chain)
  const mockLeftJoin = vi.fn((_table: unknown, _condition: unknown) => chain)
  const mockFrom = vi.fn((_table: unknown) => chain)
  Object.assign(chain, {
    innerJoin: mockInnerJoin,
    leftJoin: mockLeftJoin,
    limit: mockLimit,
    offset: mockOffset,
    where: mockWhere,
    orderBy: mockOrderBy,
    then: (resolve: (value: Array<{ total: number }>) => unknown) =>
      Promise.resolve([{ total: rows.length }]).then(resolve),
  })
  const mockSelect = vi.fn((_selection: unknown) => ({
    from: mockFrom,
  }))

  return {
    mockGetSession,
    mockLimit,
    mockOffset,
    mockOrderBy,
    mockWhere,
    mockInnerJoin,
    mockLeftJoin,
    mockFrom,
    mockSelect,
    setMockRows,
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
    workspaceId: 'workflowExecutionLogs.workspaceId',
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
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
  },
  workflowFolder: {
    id: 'workflowFolder.id',
    name: 'workflowFolder.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  gte: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'gte',
    value,
  })),
  inArray: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'inArray',
    value,
  })),
  lte: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'lte',
    value,
  })),
  not: vi.fn((condition: unknown) => ({ condition, type: 'not' })),
  notInArray: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'notInArray',
    value,
  })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    type: 'sql',
  })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const buildRow = ({
  id,
  folderName,
  workflowName,
  providerId = 'alpaca',
  startedAt = new Date('2026-04-23T00:00:00.000Z'),
}: {
  id: string
  folderName: string
  workflowName: string
  providerId?: string
  startedAt?: Date | null
}) => ({
  id,
  workflowId: 'workflow-1',
  executionId: `exec-${id}`,
  level: 'info',
  trigger: 'manual',
  startedAt,
  endedAt: new Date('2026-04-23T00:05:00.000Z'),
  totalDurationMs: 300000,
  executionData: {
    blockExecutions: [
      {
        id: `block-execution-${id}`,
        blockId: `block-${id}`,
        blockName: `Block ${id}`,
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
    trigger: {
      data: {
        monitor: {
          id: `monitor-${id}`,
          providerId,
          interval: '1m',
          indicatorId: 'rsi',
          listing: { listing_type: 'default', listing_id: 'AAPL' },
        },
      },
    },
  },
  cost: null,
  files: null,
  createdAt: new Date('2026-04-23T00:00:00.000Z'),
  workflowName,
  workflowDescription: null,
  workflowColor: '#3972F6',
  workflowFolderId: `folder-${id}`,
  workflowFolderName: folderName,
  workflowUserId: 'user-1',
  workflowWorkspaceId: 'workspace-1',
  workflowCreatedAt: new Date('2026-04-22T00:00:00.000Z'),
  workflowUpdatedAt: new Date('2026-04-23T00:00:00.000Z'),
})

const collectConditions = (value: unknown): Array<Record<string, any>> => {
  if (!value || typeof value !== 'object') {
    return []
  }

  const condition = value as Record<string, any>
  const nested =
    (condition.type === 'and' || condition.type === 'or') && Array.isArray(condition.conditions)
      ? condition.conditions.flatMap((entry: unknown) => collectConditions(entry))
      : []

  return [condition, ...nested]
}

const getLatestWhereConditions = () => {
  const whereCall = mockWhere.mock.calls.at(-1) as [unknown] | undefined
  return collectConditions(whereCall?.[0])
}

const hasSqlPattern = (conditions: Array<Record<string, any>>, pattern: string) =>
  conditions.some(
    (condition) =>
      condition.type === 'sql' &&
      (condition.strings?.join('').includes(pattern) || condition.values?.includes(pattern))
  )

const expectLogAnchoredWorkflowFolderJoin = () => {
  const fromCall = mockFrom.mock.calls.at(-1) as [unknown] | undefined
  const leftJoinCalls = mockLeftJoin.mock.calls as unknown as Array<[unknown, unknown]>

  expect(fromCall?.[0]).toMatchObject({
    id: 'workflowExecutionLogs.id',
  })
  expect(leftJoinCalls[0]?.[0]).toMatchObject({
    id: 'workflow.id',
  })
  expect(leftJoinCalls[1]?.[0]).toMatchObject({
    id: 'workflowFolder.id',
  })
  expect(mockLeftJoin.mock.invocationCallOrder[0]).toBeLessThan(
    mockLeftJoin.mock.invocationCallOrder[1]!
  )
  expect(mockLeftJoin.mock.invocationCallOrder[1]).toBeLessThan(
    mockInnerJoin.mock.invocationCallOrder[0]!
  )
}

describe('logs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    setMockRows([
      buildRow({
        id: 'log-1',
        folderName: 'Alpha Desk',
        workflowName: 'Workflow Alpha',
      }),
      buildRow({
        id: 'log-2',
        folderName: 'Beta Desk',
        workflowName: 'Workflow Beta',
      }),
    ])
  })

  it('rejects unauthorized access', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs?workspaceId=workspace-1'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it.each([
    ['missing workspaceId', 'http://localhost/api/logs'],
    ['invalid details', 'http://localhost/api/logs?workspaceId=workspace-1&details=summary'],
    ['invalid limit', 'http://localhost/api/logs?workspaceId=workspace-1&limit=0'],
  ])('returns 400 for invalid query params: %s', async (_label, url) => {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest(url))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid parameters')
    expect(body.details.length).toBeGreaterThan(0)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('uses SQL pagination and omits heavy fields for basic list requests', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/logs?workspaceId=workspace-1&limit=25&offset=50')
    )

    expect(response.status).toBe(200)
    expect(mockLimit).toHaveBeenCalledWith(25)
    expect(mockOffset).toHaveBeenCalledWith(50)

    const listSelect = mockSelect.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>
    expect(listSelect).toHaveProperty('outcome')
    expect(listSelect).not.toHaveProperty('executionData')
    expect(listSelect).not.toHaveProperty('files')

    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.data[0]?.executionData).toBeUndefined()
    expect(body.data[0]?.files).toBeUndefined()
  })

  it('filters logs by folder name', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/logs?workspaceId=workspace-1&folderName=Alpha')
    )

    expect(response.status).toBe(200)
    expectLogAnchoredWorkflowFolderJoin()
    const conditions = getLatestWhereConditions()
    expect(hasSqlPattern(conditions, 'ILIKE')).toBe(true)
    expect(hasSqlPattern(conditions, '%Alpha%')).toBe(true)
  })

  it('uses stored workflow summary fields for deleted workflow filters', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/logs?workspaceId=workspace-1&workflowIds=deleted-workflow-1&folderIds=folder-1'
      )
    )

    expect(response.status).toBe(200)
    const whereCall = mockWhere.mock.calls.at(-1) as [unknown] | undefined
    const conditions = collectConditions(whereCall?.[0])

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'inArray' &&
          condition.field === 'workflowExecutionLogs.workflowId' &&
          condition.value.includes('deleted-workflow-1')
      )
    ).toBe(true)
    expect(
      conditions.some(
        (condition) =>
          condition.type === 'inArray' &&
          condition.field?.type === 'sql' &&
          condition.field.strings?.join('').includes("->>'id'") &&
          condition.value.includes('deleted-workflow-1')
      )
    ).toBe(true)
    expect(
      conditions.some(
        (condition) =>
          condition.type === 'inArray' &&
          condition.field?.type === 'sql' &&
          condition.field.strings?.join('').includes('COALESCE(') &&
          condition.value.includes('folder-1')
      )
    ).toBe(true)
  })

  it('excludes logs by folder name', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/logs?workspaceId=workspace-1&excludeFolderName=Alpha')
    )

    expect(response.status).toBe(200)
    const conditions = getLatestWhereConditions()
    expect(hasSqlPattern(conditions, 'NOT ILIKE')).toBe(true)
    expect(hasSqlPattern(conditions, '%Alpha%')).toBe(true)
  })

  it('filters basic-detail responses by monitor fields without selecting execution data', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/logs?workspaceId=workspace-1&details=basic&providerId=alpaca'
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]?.executionData).toBeUndefined()

    const conditions = getLatestWhereConditions()
    expect(
      conditions.some(
        (condition) =>
          condition.type === 'inArray' &&
          condition.field?.strings?.join('').includes("->>'providerId'") &&
          condition.value.includes('alpaca')
      )
    ).toBe(true)
  })

  it('serializes full-detail responses without createdAt and synthesizes trace spans', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/logs?workspaceId=workspace-1&details=full&providerId=alpaca'
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    const listSelect = mockSelect.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>
    expect(listSelect).toHaveProperty('executionData')
    expect(listSelect).toHaveProperty('files')

    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: 'log-1',
        createdAt: '2026-04-23T00:00:00.000Z',
        recordCreatedAt: '2026-04-23T00:00:00.000Z',
        durationMs: 300000,
        executionData: expect.objectContaining({
          traceSpans: [
            expect.objectContaining({
              id: 'block-execution-log-1',
              blockId: 'block-log-1',
              name: 'Block log-1',
            }),
          ],
        }),
      })
    )
  })

  it('fails instead of falling back to createdAt when startedAt is missing', async () => {
    setMockRows([
      buildRow({
        id: 'log-1',
        folderName: 'Alpha Desk',
        workflowName: 'Workflow Alpha',
        startedAt: null,
      }),
    ])

    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/logs?workspaceId=workspace-1'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Workflow log log-1 is missing startedAt',
    })
  })

  it('pushes range-bound qualifiers into the SQL condition tree', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/logs?workspaceId=workspace-1&startedAtFrom=2026-04-20T00:00:00.000Z&startedAtFromExclusive=true&endedAtTo=2026-04-24T00:00:00.000Z&durationMinMs=1000&costMax=1.5'
      )
    )

    expect(response.status).toBe(200)

    const whereCall = mockWhere.mock.calls.at(-1) as [unknown] | undefined
    const conditions = collectConditions(whereCall?.[0])

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'sql' &&
          condition.values?.includes('workflowExecutionLogs.startedAt') &&
          condition.values?.some(
            (value: unknown) =>
              value instanceof Date && value.toISOString() === '2026-04-20T00:00:00.000Z'
          )
      )
    ).toBe(true)

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'lte' &&
          condition.field === 'workflowExecutionLogs.endedAt' &&
          condition.value instanceof Date &&
          condition.value.toISOString() === '2026-04-24T00:00:00.000Z'
      )
    ).toBe(true)

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'gte' &&
          condition.field === 'workflowExecutionLogs.totalDurationMs' &&
          condition.value === 1000
      )
    ).toBe(true)

    expect(
      conditions.some(
        (condition) =>
          condition.type === 'sql' &&
          condition.values?.includes(1.5) &&
          condition.strings?.join('').includes('<=')
      )
    ).toBe(true)
  })
})
