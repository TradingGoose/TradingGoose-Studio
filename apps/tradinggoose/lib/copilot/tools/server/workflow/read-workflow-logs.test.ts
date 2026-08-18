/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_COPILOT_CONTEXT_BYTES_PER_ITEM } from '@/lib/copilot/context-limits'

const mocks = vi.hoisted(() => {
  const chain: Record<string, any> = {}
  const select = vi.fn(() => chain)
  const buildRow = () => ({
    id: 'log-1',
    workflowId: 'workflow-1',
    workflowSummary: { id: 'workflow-1', name: 'Workflow' },
    executionId: 'execution-1',
    level: 'info',
    trigger: 'manual',
    startedAt: new Date('2026-04-23T00:00:00.000Z'),
    endedAt: null,
    totalDurationMs: null,
    executionData: {},
    cost: null,
  })
  const rows = [buildRow()]
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows))

  return {
    chain,
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
    resetRows: () => rows.splice(0, rows.length, buildRow()),
    rows,
    select,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  permissions: { entityType: 'perm.type', entityId: 'perm.id', userId: 'perm.userId' },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workflowId: 'workflowExecutionLogs.workflowId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
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
  workspace: { id: 'ws.id', ownerId: 'ws.ownerId', allowPersonalApiKeys: 'ws.personalKeys' },
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
  and: mocks.and,
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: mocks.eq,
  or: mocks.or,
  sql,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  requireUserId: (context?: { userId?: string }) => {
    if (!context?.userId) throw new Error('Authenticated user is required')
    return context.userId
  },
}))

describe('readWorkflowLogsServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetRows()
  })

  it('matches console logs by live workflow id or durable workflow summary id', async () => {
    const { readWorkflowLogsServerTool } = await import('./read-workflow-logs')
    const result = await readWorkflowLogsServerTool.execute(
      {
        entityId: 'deleted-workflow-1',
      },
      { userId: 'user-1', apiKeyType: 'personal' }
    )

    expect(mocks.chain.innerJoin).toHaveBeenCalled()
    expect(mocks.chain.leftJoin).toHaveBeenCalled()
    expect(mocks.eq).toHaveBeenCalledWith('perm.userId', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('ws.ownerId', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('ws.personalKeys', true)
    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionLogs.id', 'deleted-workflow-1')
    expect(mocks.eq).toHaveBeenCalledWith('workflowExecutionLogs.workflowId', 'deleted-workflow-1')
    expect(mocks.or).toHaveBeenCalled()
    expect(result).toMatchObject({
      totalEntries: 1,
      entityId: 'deleted-workflow-1',
    })
  })

  it('returns bounded, redacted details only for the exact selected execution log', async () => {
    mocks.rows[0].executionData = {
      errorDetails: { error: 'selected failure', apiKey: 'raw-secret' },
      finalOutput: { result: 'selected output' },
    }
    mocks.rows.push({ ...mocks.rows[0], id: 'log-2', executionId: 'execution-2' })

    const { readWorkflowLogsServerTool } = await import('./read-workflow-logs')
    const result = await readWorkflowLogsServerTool.execute(
      { entityId: 'log-1' },
      { userId: 'user-1' }
    )

    expect(result).toMatchObject({ entityId: 'log-1', totalEntries: 1 })
    expect(result.entries).toEqual([
      expect.objectContaining({
        id: 'log-1',
        executionData: {
          errorDetails: { apiKey: '[redacted]', error: 'selected failure' },
          finalOutput: { result: 'selected output' },
        },
      }),
    ])
    expect(JSON.stringify(result)).not.toContain('raw-secret')
  })

  it('requires authenticated server-tool context before reading console logs', async () => {
    const { readWorkflowLogsServerTool } = await import('./read-workflow-logs')

    await expect(
      readWorkflowLogsServerTool.execute({
        entityId: 'deleted-workflow-1',
      })
    ).rejects.toThrow('Authenticated user is required')

    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('defaults to bounded summaries without raw inputs, outputs, or error text', async () => {
    mocks.rows[0].executionData = {
      traceSpans: [
        {
          id: 'span-1',
          blockId: 'block-1',
          name: 'Request',
          type: 'api',
          status: 'error',
          input: { apiKey: 'raw-input-secret' },
          output: { customerPayload: 'raw-output-payload' },
        },
      ],
      errorDetails: {
        blockId: 'block-1',
        blockName: 'Request',
        error: 'raw-free-form-error',
      },
    }

    const { readWorkflowLogsServerTool } = await import('./read-workflow-logs')
    const result = await readWorkflowLogsServerTool.execute(
      { entityId: 'workflow-1' },
      { userId: 'user-1' }
    )

    expect(result.entries[0].executionData.traceSummary).toMatchObject({
      includedSpanCount: 1,
      errorSpanCount: 1,
    })
    expect(result.entries[0].executionData).not.toHaveProperty('traceSpans')
    expect(JSON.stringify(result)).not.toMatch(
      /raw-(?:input-secret|output-payload|free-form-error)/
    )
  })

  it('clamps reads and never returns execution inputs or outputs', async () => {
    mocks.rows[0].executionData = {
      traceSpans: [
        {
          id: 'span-1',
          input: { apiKey: 'raw-api-secret' },
          output: { body: 'x'.repeat(50_000) },
        },
      ],
    }
    mocks.rows.push(
      ...Array.from({ length: 10 }, (_, index) => ({
        ...mocks.rows[0],
        id: `log-${index + 2}`,
      }))
    )

    const { readWorkflowLogsServerTool } = await import('./read-workflow-logs')
    const result = await readWorkflowLogsServerTool.execute(
      { entityId: 'workflow-1', limit: 500 },
      { userId: 'user-1' }
    )

    expect(mocks.chain.limit).toHaveBeenCalledWith(11)
    expect(result.entries).toHaveLength(10)
    expect(result.truncated).toBe(true)
    expect(result.entries[0].executionData).not.toHaveProperty('traceSpans')
    expect(Buffer.byteLength(JSON.stringify(result.entries[0]), 'utf8')).toBeLessThanOrEqual(
      MAX_COPILOT_CONTEXT_BYTES_PER_ITEM
    )
    expect(JSON.stringify(result)).not.toContain('raw-api-secret')
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100))
  })
})
