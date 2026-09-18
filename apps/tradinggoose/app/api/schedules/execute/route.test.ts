/** @vitest-environment node */
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { executeScheduleJob, isScheduleExecutionPayload } from '@/background/schedule-execution'
import { GET } from './route'

const state = vi.hoisted(() => ({
  schedules: [] as Record<string, any>[],
  set: vi.fn(),
  enqueue: vi.fn(),
  resolveOffset: vi.fn(),
  run: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => {
  const workflow = { id: 'id', workspaceId: 'workspaceId', pinnedApiKeyId: 'pinnedApiKeyId' }
  const workflowSchedule = { id: 'id', nextRunAt: 'nextRunAt', status: 'status' }
  const workflows = ['workflow-1', 'workflow-2'].map((id) => ({
    id,
    workspaceId: 'workspace-1',
    pinnedApiKeyId: 'key-1',
  }))
  return {
    workflow,
    workflowSchedule,
    db: {
      select: () => {
        let table: unknown
        let predicate = (_row: Record<string, any>) => true
        const read = () =>
          (table === workflowSchedule ? state.schedules : workflows).filter(predicate)
        const query = {
          from: (value: unknown) => {
            table = value
            return query
          },
          where: (value: typeof predicate) => {
            predicate = value
            return query
          },
          limit: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve),
        }
        return query
      },
      update: () => ({ set: state.set }),
      delete: () => ({
        where: async (predicate: (row: Record<string, any>) => boolean) => {
          state.schedules = state.schedules.filter((row) => !predicate(row))
        },
      }),
    },
  }
})
vi.mock('drizzle-orm', () => ({
  eq: (key: string, value: unknown) => (row: Record<string, any>) => row[key] === value,
  lte: (key: string, value: Date) => (row: Record<string, any>) => row[key] <= value,
  and:
    (...conditions: Array<(row: Record<string, any>) => boolean>) =>
    (row: Record<string, any>) =>
      conditions.every((condition) => condition(row)),
  not: (condition: (row: Record<string, any>) => boolean) => (row: Record<string, any>) =>
    !condition(row),
}))
vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: () => null }))
vi.mock('@/lib/api-key/service', () => ({ getApiKeyOwnerUserId: async () => 'actor-1' }))
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: state.enqueue,
  isPendingExecutionLimitError: () => false,
}))
vi.mock('@/lib/timezone/timezone-resolver', () => ({
  resolveTimezoneOffsetMinutes: state.resolveOffset,
}))
vi.mock('@/lib/trigger/settings', () => ({
  TriggerExecutionUnavailableError: class extends Error {
    statusCode = 503
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: state.error }),
}))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'request', formatDateTime: vi.fn() }))
vi.mock('@/lib/workflows/execution-runner', () => ({
  loadWorkflowExecutionBlueprint: async () => ({
    workflowData: { blocks: { 'trigger-1': {} } },
  }),
  runPreparedWorkflowExecution: state.run,
}))

const request = {} as NextRequest
const occurrence = new Date('2026-09-17T12:00:00Z')
const schedule = (id = 'schedule-1', workflowId = 'workflow-1') => ({
  id,
  workflowId,
  blockId: 'trigger-1',
  cronExpression: '*/2 * * * *',
  timezone: 'America/New_York',
  nextRunAt: occurrence,
  failedCount: 1,
  status: 'active',
})

describe('schedule admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: occurrence })
    state.schedules = [schedule()]
    state.resolveOffset.mockResolvedValue(-240)
    state.run.mockResolvedValue({ result: { success: true, output: {} } })
    state.set.mockImplementation((values) => ({
      where: async (predicate: (row: Record<string, any>) => boolean) => {
        for (const row of state.schedules.filter(predicate)) Object.assign(row, values)
      },
    }))
    state.enqueue.mockImplementation(async (args) => ({
      pendingExecutionId: args.pendingExecutionId,
      inserted: true,
    }))
  })
  afterEach(() => vi.useRealTimers())

  it('returns 503 when Trigger.dev cannot accept the validated occurrence', async () => {
    state.enqueue.mockRejectedValueOnce(
      new TriggerExecutionUnavailableError('Trigger.dev unavailable')
    )
    const response = await GET(request)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Trigger.dev unavailable' })
  })

  it('queues a validated offset payload and removes orphan schedules', async () => {
    state.schedules.push({ ...schedule('orphan'), blockId: null })
    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 1 })
    expect(state.schedules).toHaveLength(1)
    expect(state.resolveOffset).toHaveBeenCalledExactlyOnceWith('America/New_York')
    const queued = state.enqueue.mock.calls[0][0]
    expect(queued).toMatchObject({
      executionType: 'schedule',
      userId: 'actor-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      pendingExecutionId: `schedule_execution:schedule-1:${occurrence.toISOString()}`,
      payload: { utcOffset: -240, cronExpression: '*/2 * * * *', failedCount: 1 },
    })
    expect(queued.payload).not.toHaveProperty('timezone')
    expect(isScheduleExecutionPayload(queued.payload)).toBe(true)
  })

  it('does nothing when there are no due schedules', async () => {
    state.schedules = []
    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 0 })
    expect(state.resolveOffset).not.toHaveBeenCalled()
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('admits independent schedules in parallel', async () => {
    state.schedules.push(schedule('schedule-2', 'workflow-2'))
    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 2 })
    expect(state.enqueue).toHaveBeenCalledTimes(2)
  })

  it.each([null, 'invalid', '2000-01-01T00:00:00Z'])(
    'does not admit missing, invalid or exhausted cron: %s',
    async (cronExpression) => {
      state.schedules[0].cronExpression = cronExpression
      expect(await (await GET(request)).json()).toMatchObject({ executedCount: 0 })
      expect(state.enqueue).not.toHaveBeenCalled()
      expect(state.set).not.toHaveBeenCalled()
      expect(state.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to trigger'),
        expect.any(Error)
      )
    }
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -9999, 9999])(
    'does not admit an invalid offset: %s',
    async (offset) => {
      state.resolveOffset.mockResolvedValue(offset)
      expect(await (await GET(request)).json()).toMatchObject({ executedCount: 0 })
      expect(state.enqueue).not.toHaveBeenCalled()
      expect(state.set).not.toHaveBeenCalled()
    }
  )

  it('keeps a timezone outage retryable and counts only distinct accepted executions', async () => {
    const error = new Error('Timezone service unavailable')
    state.resolveOffset.mockRejectedValueOnce(error)
    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 0 })
    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.set).not.toHaveBeenCalled()
    expect(state.run).not.toHaveBeenCalled()
    expect(state.schedules[0]).toMatchObject({
      failedCount: 1,
      status: 'active',
      nextRunAt: occurrence,
    })
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Failed to trigger'), error)

    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 1 })
    const first = state.enqueue.mock.calls[0][0].payload
    expect(first.executionId).toBe(`schedule_execution:schedule-1:${occurrence.toISOString()}`)
    expect(first.utcOffset).toBe(-240)
    state.run.mockResolvedValueOnce({ result: { success: false, output: {} } })
    await executeScheduleJob(first)
    expect(state.schedules[0]).toMatchObject({
      failedCount: 2,
      status: 'active',
      nextRunAt: new Date('2026-09-17T12:02:00Z'),
    })

    vi.setSystemTime(state.schedules[0].nextRunAt)
    expect(await (await GET(request)).json()).toMatchObject({ executedCount: 1 })
    const second = state.enqueue.mock.calls[1][0].payload
    expect(second.executionId).not.toBe(first.executionId)
    expect(second.failedCount).toBe(2)
    await executeScheduleJob(second)
    expect(state.schedules[0]).toMatchObject({
      failedCount: 0,
      status: 'active',
      nextRunAt: new Date('2026-09-17T12:04:00Z'),
    })
    expect(state.run.mock.calls.map(([args]) => args.executionId)).toEqual([
      first.executionId,
      second.executionId,
    ])
    // Both workers use their admitted offsets, without another network lookup.
    expect(state.resolveOffset).toHaveBeenCalledTimes(3)
    expect(state.set.mock.calls.every(([values]) => values.status !== 'disabled')).toBe(true)
  })
})
