/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  asc: vi.fn((value: unknown) => ({ type: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, type: 'inArray', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflow: {
    folderId: 'workflow.folderId',
  },
  workflowExecutionLogs: {
    workspaceId: 'workflowExecutionLogs.workspaceId',
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    startedAt: 'workflowExecutionLogs.startedAt',
    id: 'workflowExecutionLogs.id',
    trigger: 'workflowExecutionLogs.trigger',
    level: 'workflowExecutionLogs.level',
    executionId: 'workflowExecutionLogs.executionId',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    cost: 'workflowExecutionLogs.cost',
    executionData: 'workflowExecutionLogs.executionData',
  },
}))

const sql = vi.hoisted(() => {
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    type: 'sql',
    values,
  })) as any
  return tag
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  asc: mocks.asc,
  desc: mocks.desc,
  eq: mocks.eq,
  gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
  inArray: mocks.inArray,
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
  or: mocks.or,
  sql,
}))

describe('v1 log filters', () => {
  it('anchors workspace filters on durable log workspace and preserves deleted workflow matching', async () => {
    const { buildLogFilters } = await import('./filters')

    buildLogFilters({
      workspaceId: 'workspace-1',
      workflowIds: ['workflow-1'],
    })

    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionLogs.workspaceId', 'workspace-1')
    expect(mocks.inArray).toHaveBeenCalledWith('workflowExecutionLogs.workflowId', ['workflow-1'])
    expect(mocks.inArray).toHaveBeenCalledWith(
      expect.objectContaining({
        values: ['workflowExecutionLogs.workflowSummary'],
      }),
      ['workflow-1']
    )
    expect(mocks.or).toHaveBeenCalled()
  })

  it('orders cursor pages by the complete startedAt and id tuple', async () => {
    const { getOrderBy } = await import('./filters')

    expect(getOrderBy('desc')).toEqual([
      { type: 'desc', value: 'workflowExecutionLogs.startedAt' },
      { type: 'desc', value: 'workflowExecutionLogs.id' },
    ])
    expect(getOrderBy('asc')).toEqual([
      { type: 'asc', value: 'workflowExecutionLogs.startedAt' },
      { type: 'asc', value: 'workflowExecutionLogs.id' },
    ])
    expect(mocks.desc).toHaveBeenCalledWith('workflowExecutionLogs.startedAt')
    expect(mocks.desc).toHaveBeenCalledWith('workflowExecutionLogs.id')
    expect(mocks.asc).toHaveBeenCalledWith('workflowExecutionLogs.startedAt')
    expect(mocks.asc).toHaveBeenCalledWith('workflowExecutionLogs.id')
  })
})
