/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pendingRows: [] as unknown[],
  logRows: [] as unknown[],
  select: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      mocks.select(fields)
      const rows = 'status' in fields ? mocks.pendingRows : mocks.logRows
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      }
    },
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => null),
  getRedisStorageMode: vi.fn(() => 'redis'),
}))

import { readWorkflowExecutionEventState } from './workflow-execution-events'

const startedAt = new Date('2026-08-20T12:00:00.000Z')

describe('readWorkflowExecutionEventState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pendingRows.length = 0
    mocks.logRows.length = 0
  })

  it('prefers a finalized error log over a stale processing row', async () => {
    mocks.pendingRows.push({ status: 'processing' })
    mocks.logRows.push({
      level: 'error',
      startedAt,
      endedAt: new Date('2026-08-20T12:10:00.000Z'),
      totalDurationMs: 600_000,
      executionData: {
        finalOutput: { error: 'Workflow execution time limit exceeded' },
      },
    })

    const state = await readWorkflowExecutionEventState({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      afterEventId: 0,
    })

    expect(state).toMatchObject({
      status: 'failed',
      failureReason: 'Workflow execution time limit exceeded',
      result: {
        success: false,
        error: 'Workflow execution time limit exceeded',
      },
      events: [],
    })
  })

  it('uses pending state before a workflow log exists', async () => {
    mocks.pendingRows.push({ status: 'pending' })

    const state = await readWorkflowExecutionEventState({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      afterEventId: 0,
    })

    expect(state).toEqual({
      status: 'pending',
      result: null,
      failureReason: null,
      events: [],
    })
  })
})
