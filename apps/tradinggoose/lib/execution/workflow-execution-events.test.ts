/**
 * @vitest-environment node
 */
import { pendingExecution } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pendingRows: [] as unknown[],
  logRows: [] as unknown[],
  storageMode: 'redis' as 'redis' | 'local',
  dbSelect: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.dbSelect.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: (query: SQL) => {
          mocks.where(query)
          return {
            limit: async () => (table === pendingExecution ? mocks.pendingRows : mocks.logRows),
          }
        },
      }),
    })),
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => null),
  getRedisStorageMode: vi.fn(() => mocks.storageMode),
}))

import {
  createWorkflowExecutionEventWriter,
  readWorkflowExecutionEventState,
} from './workflow-execution-events'

beforeEach(() => {
  mocks.pendingRows.length = 0
  mocks.logRows.length = 0
  mocks.storageMode = 'redis'
  mocks.dbSelect.mockClear()
  mocks.where.mockClear()
})

it('retains the local event buffer when the server module reloads', async () => {
  mocks.storageMode = 'local'
  mocks.pendingRows.push({ status: 'processing' })
  const params = { pendingExecutionId: 'hmr-execution', workflowId: 'workflow-1' }
  const writer = createWorkflowExecutionEventWriter(params)
  await writer.write({ type: 'stream:chunk', data: { blockId: 'agent', chunk: 'before reload' } })
  vi.resetModules()
  const reloaded = await import('./workflow-execution-events')
  await writer.write({ type: 'stream:chunk', data: { blockId: 'agent', chunk: 'after reload' } })
  const state = await reloaded.readWorkflowExecutionEventState({ ...params, afterEventId: 0 })
  expect(state?.events.map(({ event }) => event.data)).toEqual([
    { blockId: 'agent', chunk: 'before reload' },
    { blockId: 'agent', chunk: 'after reload' },
  ])
})

it('prefers a finalized error log and otherwise uses pending state', async () => {
  mocks.pendingRows.push({ status: 'processing' })
  mocks.logRows.push({
    level: 'error',
    startedAt: new Date('2026-08-20T12:00:00.000Z'),
    endedAt: new Date('2026-08-20T12:10:00.000Z'),
    totalDurationMs: 600_000,
    executionData: {
      errorMessage: 'Workflow execution time limit exceeded',
      finalOutput: { error: 'ordinary block output' },
    },
  })

  const params = {
    pendingExecutionId: 'execution-1',
    workflowId: 'workflow-1',
    afterEventId: 0,
  }
  await expect(readWorkflowExecutionEventState(params)).resolves.toMatchObject({
    status: 'failed',
    failureReason: 'Workflow execution time limit exceeded',
    result: {
      success: false,
      error: 'Workflow execution time limit exceeded',
      output: { error: 'ordinary block output' },
    },
    events: [],
  })

  mocks.logRows.length = 0
  mocks.pendingRows[0] = { status: 'pending' }
  await expect(readWorkflowExecutionEventState(params)).resolves.toEqual({
    status: 'pending',
    result: null,
    failureReason: null,
    events: [],
  })
})

it('refuses a success event without its durable execution log', async () => {
  mocks.storageMode = 'local'
  const writer = createWorkflowExecutionEventWriter({
    pendingExecutionId: 'local-execution-1',
    workflowId: 'workflow-1',
  })

  await writer.write({
    type: 'execution:completed',
    data: { result: { success: true, output: { ok: true } } },
  })

  expect(mocks.dbSelect).not.toHaveBeenCalled()
  await expect(
    readWorkflowExecutionEventState({
      pendingExecutionId: 'local-execution-1',
      workflowId: 'workflow-1',
      afterEventId: 0,
    })
  ).rejects.toThrow('durable execution log')
})

it.each(['info', 'error'])(
  'replays the durable %s result after workflow deletion despite a settlement failure event',
  async (level) => {
    mocks.storageMode = 'local'
    const params = {
      pendingExecutionId: `settlement-${level}`,
      workflowId: 'workflow-1',
      afterEventId: 0,
    }
    await createWorkflowExecutionEventWriter(params).write({
      type: 'execution:error',
      data: {
        error: 'Usage ledger unavailable',
        result: { success: false, output: {}, error: 'Usage ledger unavailable' },
      },
    })
    mocks.logRows.push({
      workflowId: null,
      workflowSummary: { id: params.workflowId },
      level,
      startedAt: new Date('2026-09-17T10:00:00Z'),
      endedAt: new Date('2026-09-17T11:00:03Z'),
      totalDurationMs: 5000,
      executionData: {
        finalOutput: { completedWork: true },
        ...(level === 'error' ? { errorMessage: 'Block failed' } : {}),
        billing: { accountedCost: 2 },
      },
    })

    const state = await readWorkflowExecutionEventState(params)
    expect(state).toMatchObject({
      status: level === 'error' ? 'failed' : 'completed',
      result: {
        success: level !== 'error',
        output: { completedWork: true },
        metadata: { duration: 5000 },
      },
      failureReason: level === 'error' ? 'Block failed' : null,
      events: [],
    })
    expect(JSON.stringify(state)).not.toContain('accountedCost')
    expect(JSON.stringify(state)).not.toContain('Usage ledger unavailable')
    expect(mocks.where).toHaveBeenCalledOnce()
    const dialect = new PgDialect()
    const query = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(query.sql).toBe(
      '("workflow_execution_logs"."execution_id" = $1 and "workflow_execution_logs"."workflow_summary"->>\'id\' = $2)'
    )
    expect(query.params).toEqual([params.pendingExecutionId, params.workflowId])
    const owners = dialect.sqlToQuery(mocks.dbSelect.mock.calls[0][0].hasOtherWorkflowOwners)
    expect(owners.sql).toContain('"workflow_execution_logs"."ended_at" is not null')
    expect(owners.sql).toContain('exists (select 1 from "pending_execution"')
    expect(owners.sql).toContain(
      '"pending_execution"."execution_type" = $1 and "pending_execution"."id" <> $2'
    )
    expect(owners.params).toEqual(['workflow', params.pendingExecutionId])
  }
)

it.each([
  ['reconstructed pause', 'paused', null],
  ['stale pause after claim', 'processing', 1],
  ['stale pause before another review', 'paused', 1],
  ['stale pause after completion', 'completed', 1],
  ['current pause', 'paused', 2],
] as const)('uses durable state for %s', async (name, status, bufferedRevision) => {
  mocks.storageMode = 'local'
  const params = { pendingExecutionId: name, workflowId: 'workflow-1', afterEventId: 0 }
  const result =
    status === 'processing'
      ? null
      : {
          success: true,
          ...(status === 'paused' ? { status } : {}),
          output: status === 'paused' ? { revision: 2, url: '/review' } : { answer: 42 },
        }
  if (bufferedRevision !== null) {
    await createWorkflowExecutionEventWriter(params).write({
      type: 'execution:paused',
      data: {
        result: {
          success: true,
          status: 'paused',
          output: { revision: bufferedRevision, url: '/review' },
        },
      },
    })
  }
  mocks.logRows.push({
    level: 'info',
    startedAt: new Date('2026-09-16T12:00:00Z'),
    endedAt: status === 'completed' ? new Date('2026-09-16T12:01:00Z') : null,
    totalDurationMs: null,
    executionData:
      status === 'paused' ? { pause: result!.output } : { finalOutput: { answer: 42 } },
  })
  await expect(readWorkflowExecutionEventState(params)).resolves.toMatchObject({
    status,
    failureReason: null,
    result,
    events:
      bufferedRevision === 2 ? [{ event: { type: 'execution:paused', data: { result } } }] : [],
  })
})
