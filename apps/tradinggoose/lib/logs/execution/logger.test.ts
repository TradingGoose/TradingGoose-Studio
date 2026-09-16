import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { ExecutionLogger } from '@/lib/logs/execution/logger'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: { select: mocks.select, update: mocks.update },
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getEffectiveSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  checkUsageStatus: vi.fn(),
  maybeSendUsageThresholdEmail: vi.fn(),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@/lib/logs/events', () => ({
  emitWorkflowExecutionCompleted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {},
}))

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: mocks.limit }) }) })
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ returning: mocks.returning })
    logger = new ExecutionLogger()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(ExecutionLogger)
    })
  })

  const row = {
    id: 'log-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    stateSnapshotId: 'snapshot-1',
    workflowSummary: { id: 'workflow-1' },
    trigger: 'webhook',
    level: 'info',
    startedAt: new Date('2026-09-16T12:00:00Z'),
    createdAt: new Date('2026-09-16T12:00:00Z'),
    endedAt: null,
    executionData: {
      environment: {
        userId: 'original-actor',
        workspaceId: 'workspace-1',
        variables: { count: '1' },
      },
      checkpoint: { revision: 2, encryptedSnapshot: 'private-snapshot', activeJobId: 'resume-2' },
      pause: { revision: 2, url: '/review/execution-1' },
      untouched: 'preserve-current-value',
    },
  }
  const completion = {
    executionId: 'execution-1',
    workflowLogId: 'log-1',
    workspaceId: 'workspace-1',
    endedAt: '2026-09-16T12:01:00Z',
    totalDurationMs: 1000,
    finalOutput: { done: true },
    traceSpans: [],
    costSummary: {
      totalCost: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      baseExecutionCharge: 0,
      modelCost: 0,
      models: {},
    },
  }

  test.each([true, false])(
    'atomically removes paused state on completion (success=%s)',
    async (success) => {
      mocks.limit.mockResolvedValue([row])
      mocks.returning.mockImplementation(async () => {
        const update = mocks.set.mock.calls[0][0]
        const query = new PgDialect().sqlToQuery(update.executionData)
        expect(query.sql).toBe(
          "(coalesce(\"workflow_execution_logs\".\"execution_data\", '{}'::jsonb) || $1::jsonb) - 'checkpoint' - 'pause'"
        )
        const patch = JSON.parse(query.params[0] as string)
        expect(patch).not.toHaveProperty('checkpoint')
        expect(patch).not.toHaveProperty('pause')
        expect(patch).not.toHaveProperty('untouched')
        expect(query.params.join('')).not.toContain('private-snapshot')
        // Apply the compiled merge against newer row data, not the earlier SELECT snapshot.
        const {
          checkpoint: _checkpoint,
          pause: _pause,
          ...currentData
        } = {
          ...row.executionData,
          untouched: 'concurrent-update',
          ...patch,
        }
        return [{ ...row, ...update, executionData: currentData }]
      })

      const result = await logger.completeWorkflowExecution({
        ...completion,
        success,
        variables: { count: '2' },
      })

      const guard = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0])
      expect(guard.sql).toContain('"ended_at" is null')
      expect(guard.params).toEqual(['log-1', 'execution-1', 'workspace-1'])
      expect(result.executionData).toMatchObject({
        environment: {
          userId: 'original-actor',
          workspaceId: 'workspace-1',
          variables: { count: '2' },
        },
        untouched: 'concurrent-update',
        finalOutput: { done: true },
      })
      expect(result.executionData).not.toHaveProperty('checkpoint')
      expect(result.executionData).not.toHaveProperty('pause')
      expect(emitWorkflowExecutionCompleted).toHaveBeenCalledExactlyOnceWith(result)
    }
  )

  test('does not bill or emit another completion when the log is already terminal', async () => {
    const completedRow = {
      ...row,
      endedAt: new Date(completion.endedAt),
      executionData: { finalOutput: { done: true } },
    }
    mocks.limit.mockResolvedValue([completedRow])
    mocks.returning.mockResolvedValue([])

    const result = await logger.completeWorkflowExecution({ ...completion, success: true })

    expect(result.executionData).toEqual({ finalOutput: { done: true } })
    expect(emitWorkflowExecutionCompleted).not.toHaveBeenCalled()
    expect(isBillingEnabledForRuntime).not.toHaveBeenCalled()
  })
})
