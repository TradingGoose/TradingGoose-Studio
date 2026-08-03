import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  wake: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({ db: { transaction: mocks.transaction } }))

vi.mock('@tradinggoose/db/schema', () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_target, property) => `${name}.${String(property)}` })
  return {
    pendingExecution: table('pending'),
    workflowExecutionLogs: table('logs'),
    workflowExecutionTerminal: table('terminal'),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...values) => values),
  eq: vi.fn((...values) => values),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: [...strings],
      values,
    })),
    {
      param: vi.fn((value, encoder) => ({ encoder, value })),
    }
  ),
}))

vi.mock('./pending-execution-drain-wake', () => ({
  wakePendingExecutionDrain: mocks.wake,
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  createWorkflowExecutionEventWriter: vi.fn(),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({ buildTraceSpans: vi.fn() }))
vi.mock('@/lib/workflows/execution-events', () => ({
  createWorkflowExecutionTerminalEventInput: vi.fn(),
}))

import { projectChildWorkflowExecution } from './workflow-execution-projections'

describe('workflow execution projection JSONB bindings', () => {
  it('encodes the canonical child result with the execution-data JSONB column', async () => {
    const result = { success: false, output: {}, error: 'child failed' }
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([{ id: 'root-1', state: 'running', result: null }]),
    }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    const updateChain = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) }
    updateChain.set.mockReturnValue(updateChain)
    const deleteChain = {
      where: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ billingScopeId: 'scope-1' }]),
    }
    deleteChain.where.mockReturnValue(deleteChain)
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({
        execute: vi.fn(),
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
        delete: vi.fn(() => deleteChain),
      })
    )
    mocks.wake.mockResolvedValue(undefined)

    await expect(
      projectChildWorkflowExecution({
        rootExecutionId: 'root-1',
        pendingExecutionId: 'child-1',
        attemptId: 'attempt-1',
        result,
      })
    ).resolves.toBe(true)

    expect(sql.param).toHaveBeenCalledWith(result, 'logs.executionData')
    const executionData = updateChain.set.mock.calls[0]?.[0].executionData
    const resultIndex = executionData.values.findIndex(
      (parameter: { encoder?: unknown; value?: unknown }) =>
        parameter?.encoder === 'logs.executionData' && parameter.value === result
    )
    expect(resultIndex).toBeGreaterThanOrEqual(0)
    expect(executionData.strings[resultIndex + 1]?.trimStart()).toMatch(/^::jsonb\b/)
  })
})
