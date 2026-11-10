import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalLogFixture,
  hydrateCanonicalLogFixture,
} from '@/lib/execution/__test-utils__/canonical-log-fixture'
import {
  executeScheduleJob,
  isScheduleExecutionPayload,
  type ScheduleExecutionPayload,
} from './schedule-execution'

const mocks = vi.hoisted(() => ({
  runPreparedWorkflowExecution: vi.fn(),
  loadWorkflowExecutionBlueprint: vi.fn(),
  nextRunAt: new Date('2026-09-16T12:04:00.000Z'),
  set: vi.fn(),
  updateWhere: vi.fn(),
  delete: vi.fn(),
  info: vi.fn(),
  verify: vi.fn(),
  logRows: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: mocks.verify }))

vi.mock('@/lib/workflow-archive/functional', () => ({
  hydrateExecutionPayload: hydrateCanonicalLogFixture,
  assertRetainedLogAccess: async () => {},
}))

vi.mock('@tradinggoose/db', () => ({
  workflow: { id: 'workflow.id' },
  workflowSchedule: { id: 'workflowSchedule.id', nextRunAt: 'workflowSchedule.nextRunAt' },
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            fields
              ? 'level' in fields
                ? mocks.logRows.map(canonicalLogFixture)
                : []
              : [{ id: 'workflow-1', workspaceId: 'workspace-1', pinnedApiKeyId: 'key-1' }],
        }),
      }),
    }),
    update: () => ({ set: mocks.set }),
    delete: mocks.delete,
  },
}))
vi.mock('@/lib/api-key/service', () => ({ getApiKeyOwnerUserId: async () => 'actor-1' }))
vi.mock('@/lib/redis', () => ({
  getRedisClient: () => null,
  getRedisStorageMode: () => 'redis',
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: mocks.info, warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/workflows/execution-runner', () => ({
  loadWorkflowExecutionBlueprint: mocks.loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution: async (...args: unknown[]) => {
    try {
      return await mocks.runPreparedWorkflowExecution(...args)
    } finally {
      // This run crosses the next two-minute schedule occurrence before settling.
      vi.setSystemTime(new Date('2026-09-16T12:02:05.000Z'))
    }
  },
}))

const payload = {
  executionId: 'execution-1',
  scheduleId: 'schedule-1',
  workflowId: 'workflow-1',
  blockId: 'trigger-1',
  utcOffset: 0,
  cronExpression: '*/2 * * * *',
  now: '2026-09-16T12:00:00.000Z',
  failedCount: 2,
} satisfies ScheduleExecutionPayload

describe('executeScheduleJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: new Date(payload.now) })
    mocks.logRows = []
    mocks.verify.mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
    mocks.set.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue(undefined)
    mocks.loadWorkflowExecutionBlueprint.mockResolvedValue({
      workflowContext: { workspaceId: 'workspace-1' },
      workflowData: { blocks: { 'trigger-1': {} } },
    })
  })
  afterEach(() => vi.useRealTimers())

  it.each(['executionId', 'cronExpression', 'utcOffset'])(
    'requires canonical queued schedule field %s',
    (field) => {
      expect(isScheduleExecutionPayload({ ...payload, [field]: undefined })).toBe(false)
    }
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0', undefined])(
    'rejects unresolved or non-finite offsets: %s',
    (utcOffset) => {
      expect(isScheduleExecutionPayload({ ...payload, timezone: 'UTC', utcOffset })).toBe(false)
    }
  )

  it('records invalid cron without inventing a replacement next run date', async () => {
    await expect(executeScheduleJob({ ...payload, cronExpression: 'invalid' })).rejects.toThrow()
    expect(mocks.runPreparedWorkflowExecution).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
      updatedAt: new Date(payload.now),
      failedCount: 3,
      status: 'disabled',
      lastFailedAt: new Date(payload.now),
    })
  })

  it('uses the admitted offset when advancing the configured local schedule', async () => {
    mocks.runPreparedWorkflowExecution.mockResolvedValue({ result: { success: true, output: {} } })
    await executeScheduleJob({ ...payload, cronExpression: '0 9 * * *', utcOffset: -240 })
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
      updatedAt: new Date(payload.now),
      nextRunAt: new Date('2026-09-16T13:00:00.000Z'),
      lastRanAt: new Date(payload.now),
      failedCount: 0,
    })
  })

  it.each([
    [undefined, undefined],
    ['paused', undefined],
    [undefined, new Error('Schedule update unavailable')],
  ] as const)(
    'does not count a workflow failure for status %s and schedule update error %s',
    async (status, updateError) => {
      mocks.runPreparedWorkflowExecution.mockResolvedValue({
        result: { success: true, status, output: {} },
      })
      if (updateError) mocks.updateWhere.mockRejectedValueOnce(updateError)

      const execution = executeScheduleJob(payload)
      if (updateError) await expect(execution).rejects.toBe(updateError)
      else await expect(execution).resolves.toBeUndefined()

      expect(mocks.runPreparedWorkflowExecution).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          executionId: 'execution-1',
          contextExtensions: { pendingExecutionId: 'execution-1' },
          actorUserId: 'actor-1',
          triggerType: 'schedule',
          triggerTarget: { kind: 'block', blockId: 'trigger-1' },
        })
      )
      expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
        updatedAt: new Date(payload.now),
        nextRunAt: mocks.nextRunAt,
        lastRanAt: new Date(payload.now),
        failedCount: 0,
      })
      expect(mocks.delete).not.toHaveBeenCalled()
      expect(mocks.info).toHaveBeenLastCalledWith(
        `[executio] Workflow workflow-1 ${status ?? 'executed successfully'}`
      )
    }
  )

  it('still counts real execution failures and disables at the configured threshold', async () => {
    mocks.runPreparedWorkflowExecution.mockResolvedValue({ result: { success: false, output: {} } })

    await executeScheduleJob(payload)

    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
      updatedAt: new Date(payload.now),
      nextRunAt: mocks.nextRunAt,
      lastFailedAt: new Date(payload.now),
      failedCount: 3,
      status: 'disabled',
    })
  })

  it('reschedules usage-limited dispatches without counting an execution failure', async () => {
    mocks.runPreparedWorkflowExecution.mockResolvedValue({
      result: { success: false, error: 'Usage limit exceeded', output: {} },
      dispatchFailureReason: 'usage_limit_exceeded',
    })
    await executeScheduleJob(payload)
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
      updatedAt: new Date(payload.now),
      nextRunAt: mocks.nextRunAt,
    })
  })

  it.each([
    ['info', payload.cronExpression],
    ['error', payload.cronExpression],
    ['info', payload.now],
    [undefined, payload.cronExpression],
  ] as const)(
    'uses the durable %s outcome after execution throws for %s',
    async (level, cronExpression) => {
      const error = new Error(level ? 'Ledger unavailable' : 'descendant cleanup failed')
      mocks.runPreparedWorkflowExecution.mockImplementationOnce(async () => {
        if (level) {
          mocks.logRows = [
            {
              level,
              startedAt: new Date(payload.now),
              endedAt: new Date(payload.now),
              totalDurationMs: 0,
              executionData: { finalOutput: { executed: true } },
            },
          ]
        }
        throw error
      })

      await expect(executeScheduleJob({ ...payload, cronExpression })).rejects.toBe(error)
      expect(mocks.runPreparedWorkflowExecution).toHaveBeenCalledTimes(1)
      expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
        updatedAt: new Date(payload.now),
        nextRunAt: cronExpression === payload.now ? null : mocks.nextRunAt,
        ...(level === 'info'
          ? { lastRanAt: new Date(payload.now), failedCount: 0 }
          : { lastFailedAt: new Date(payload.now), failedCount: 3, status: 'disabled' }),
        ...(cronExpression === payload.now ? { status: 'disabled' } : {}),
      })
    }
  )
  it('does not count preserved functional work as a successful schedule while financial proof refuses', async () => {
    const unavailable = new Error('Original base occurrence remains unaccepted')
    mocks.runPreparedWorkflowExecution.mockRejectedValueOnce(
      new Error('Ledger acceptance unavailable')
    )
    mocks.logRows = [
      {
        level: 'info',
        startedAt: new Date(payload.now),
        endedAt: new Date(payload.now),
        executionData: { finalOutput: { completedWork: true } },
      },
    ]
    mocks.verify.mockRejectedValueOnce(unavailable)
    await expect(executeScheduleJob(payload)).rejects.toBe(unavailable)
    expect(mocks.runPreparedWorkflowExecution).toHaveBeenCalledOnce()
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.logRows[0]).toMatchObject({
      level: 'info',
      executionData: { finalOutput: { completedWork: true } },
    })
  })
})
