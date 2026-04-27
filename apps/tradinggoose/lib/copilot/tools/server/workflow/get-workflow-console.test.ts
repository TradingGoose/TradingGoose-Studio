/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() =>
    Promise.resolve([
      {
        id: 'log-1',
        executionId: 'execution-1',
        level: 'info',
        trigger: 'manual',
        startedAt: new Date('2026-04-23T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: {},
        cost: null,
      },
    ])
  )

  return {
    chain,
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
    select: vi.fn(() => chain),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    executionId: 'workflowExecutionLogs.executionId',
    level: 'workflowExecutionLogs.level',
    trigger: 'workflowExecutionLogs.trigger',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    executionData: 'workflowExecutionLogs.executionData',
    cost: 'workflowExecutionLogs.cost',
  },
}))

const sql = vi.hoisted(() => {
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })) as any
  return tag
})

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: mocks.eq,
  or: mocks.or,
  sql,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

describe('getWorkflowConsoleServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches console logs by live workflow id or durable workflow summary id', async () => {
    const { getWorkflowConsoleServerTool } = await import('./get-workflow-console')
    const result = await getWorkflowConsoleServerTool.execute({
      workflowId: 'deleted-workflow-1',
      includeDetails: false,
    })

    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionLogs.workflowId', 'deleted-workflow-1')
    expect(mocks.or).toHaveBeenCalled()
    expect(result).toMatchObject({
      totalEntries: 1,
      workflowId: 'deleted-workflow-1',
    })
  })
})
