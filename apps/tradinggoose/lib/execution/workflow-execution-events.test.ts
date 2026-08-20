/**
 * @vitest-environment node
 */
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pendingRows: [] as unknown[],
  logRows: [] as unknown[],
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
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

it('prefers a finalized error log and otherwise uses pending state', async () => {
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
