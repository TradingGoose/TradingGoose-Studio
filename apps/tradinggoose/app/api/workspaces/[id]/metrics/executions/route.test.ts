/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockSelect,
  mockPermissionLimit,
  mockWorkflowsWhere,
  mockLogsWhere,
  mockLeftJoin,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockPermissionLimit = vi.fn()
  const mockWorkflowsWhere = vi.fn()
  const mockLogsWhere = vi.fn()
  const mockLeftJoin = vi.fn(() => ({
    where: mockLogsWhere,
  }))
  const mockSelect = vi.fn()

  return {
    mockGetSession,
    mockSelect,
    mockPermissionLimit,
    mockWorkflowsWhere,
    mockLogsWhere,
    mockLeftJoin,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  workflow: {
    folderId: 'workflow.folderId',
    id: 'workflow.id',
    name: 'workflow.name',
    workspaceId: 'workflow.workspaceId',
  },
  workflowExecutionLogs: {
    executionId: 'workflowExecutionLogs.executionId',
    level: 'workflowExecutionLogs.level',
    startedAt: 'workflowExecutionLogs.startedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    trigger: 'workflowExecutionLogs.trigger',
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({
    field,
    type: 'inArray',
    value,
  })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

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

describe('workspace execution metrics route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mockPermissionLimit,
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: mockWorkflowsWhere,
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          leftJoin: mockLeftJoin,
        })),
      })
    mockPermissionLimit.mockResolvedValue([{ id: 'permission-1' }])
    mockWorkflowsWhere.mockResolvedValue([])
    mockLogsWhere.mockResolvedValue([
      {
        workflowId: null,
        workflowSummary: {
          folderId: 'folder-1',
          id: 'deleted-workflow-1',
          name: 'Deleted Workflow',
        },
        workflowName: null,
        level: 'info',
        startedAt: new Date('2026-04-23T00:30:00.000Z'),
        totalDurationMs: 42,
      },
    ])
  })

  it('includes detached logs in filtered metrics using workflowSummary fallback fields', async () => {
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/workspaces/workspace-1/metrics/executions?startTime=2026-04-23T00:00:00.000Z&endTime=2026-04-23T01:00:00.000Z&segments=1&workflowIds=deleted-workflow-1&folderIds=folder-1'
      ),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.workflows).toEqual([
      expect.objectContaining({
        workflowId: 'deleted-workflow-1',
        workflowName: 'Deleted Workflow',
        segments: [
          expect.objectContaining({
            avgDurationMs: 42,
            successfulExecutions: 1,
            totalExecutions: 1,
          }),
        ],
      }),
    ])

    const conditions = collectConditions(mockLogsWhere.mock.calls[0][0])
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
})
