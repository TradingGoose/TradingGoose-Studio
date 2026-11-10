/**
 * @vitest-environment node
 */
import { beforeEach, expect, it, vi } from 'vitest'
import {
  canonicalLogFixture,
  hydrateCanonicalLogFixture,
} from '@/lib/execution/__test-utils__/canonical-log-fixture'

const mocks = vi.hoisted(() => ({
  pendingRows: [] as unknown[],
  logRows: [] as unknown[],
  storageMode: 'redis' as 'redis' | 'local',
  dbSelect: vi.fn(),
  verify: vi.fn(),
  hydrate: vi.fn(),
}))

vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: mocks.verify }))

vi.mock('@/lib/workflow-archive/functional', () => ({
  hydrateExecutionPayload: mocks.hydrate,
  assertRetainedLogAccess: async () => {},
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.dbSelect.mockImplementation((fields: Record<string, unknown>) => {
      const rows = 'status' in fields ? mocks.pendingRows : mocks.logRows.map(canonicalLogFixture)
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      }
    }),
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
  readVerifiedWorkflowExecutionData,
  readWorkflowExecutionEventState,
  readWorkflowExecutionResultFromLog,
} from './workflow-execution-events'

beforeEach(() => {
  mocks.pendingRows.length = 0
  mocks.logRows.length = 0
  mocks.storageMode = 'redis'
  mocks.dbSelect.mockClear()
  mocks.hydrate.mockReset().mockImplementation(hydrateCanonicalLogFixture)
  mocks.verify
    .mockReset()
    .mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
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

it('refuses a buffered happy terminal without its durable financially accepted owner', async () => {
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
  ).rejects.toThrow('durable financial owner')
})

it.each(['info', 'error'])(
  'keeps the durable %s result when settlement emits a failure event',
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
      level,
      startedAt: new Date('2026-09-17T10:00:00Z'),
      endedAt: new Date('2026-09-17T11:00:03Z'),
      totalDurationMs: 5000,
      executionData: {
        finalOutput: { completedWork: true },
        ...(level === 'error' ? { errorMessage: 'Block failed' } : {}),
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

it.each(['completed', 'paused'] as const)(
  'refuses preserved %s work until its original base occurrence is accepted',
  async (status) => {
    const params = { pendingExecutionId: `unaccepted-${status}`, workflowId: 'workflow-1' }
    const row = {
      level: 'info',
      startedAt: new Date('2026-09-16T12:00:00Z'),
      endedAt: status === 'completed' ? new Date('2026-09-16T12:01:00Z') : null,
      executionData:
        status === 'completed'
          ? { finalOutput: { paidWork: 'preserved' } }
          : { pause: { revision: 1 } },
    }
    mocks.logRows.push(row)
    mocks.verify.mockRejectedValueOnce(new Error('Original base occurrence remains unaccepted'))
    await expect(readWorkflowExecutionEventState(params)).rejects.toThrow(
      'Original base occurrence remains unaccepted'
    )
    expect(row.executionData).toEqual(
      status === 'completed'
        ? { finalOutput: { paidWork: 'preserved' } }
        : { pause: { revision: 1 } }
    )
    await expect(readWorkflowExecutionEventState(params)).resolves.toMatchObject({
      status,
      result: { success: true },
    })
  }
)

it('refuses absent original binding even when a terminal output and buffered completion exist', async () => {
  mocks.storageMode = 'local'
  const params = { pendingExecutionId: 'missing-binding', workflowId: 'workflow-1' }
  await createWorkflowExecutionEventWriter(params).write({
    type: 'execution:completed',
    data: { result: { success: true, output: { ready: true } } },
  })
  mocks.logRows.push({
    level: 'info',
    startedAt: new Date(),
    endedAt: new Date(),
    executionData: { finalOutput: { ready: true }, billing: {} },
  })
  await expect(readWorkflowExecutionEventState(params)).rejects.toThrow(
    'Original workflow financial binding'
  )
  expect(mocks.verify).not.toHaveBeenCalled()
})

it('refuses every unowned buffered happy event even when a later failure would hide its terminal status', async () => {
  mocks.storageMode = 'local'
  const params = {
    pendingExecutionId: 'unowned-happy-before-error',
    workflowId: 'workflow-1',
    afterEventId: 0,
  }
  const writer = createWorkflowExecutionEventWriter(params)
  await writer.write({
    type: 'execution:completed',
    data: { result: { success: true, output: { leaked: true } } },
  })
  await writer.write({
    type: 'execution:error',
    data: {
      error: 'Later failure',
      result: { success: false, output: {}, error: 'Later failure' },
    },
  })
  await expect(readWorkflowExecutionEventState(params)).rejects.toThrow('durable financial owner')
})

it('does not treat a preserved archive reference as original financial proof', async () => {
  const row = canonicalLogFixture({
    id: 'preserved-log',
    executionId: 'preserved-execution',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    level: 'info',
    startedAt: new Date(),
    endedAt: new Date(),
    totalDurationMs: 1,
    executionData: {
      preservedFunctionalArchive: {
        version: 1,
        purpose: 'workflow-archive',
        workspaceId: 'workspace-1',
        executionId: 'preserved-execution',
        logId: 'preserved-log',
        provider: 'local',
        key: 'archive',
        digest: 'digest',
      },
      billing: {},
    },
  })
  await expect(readVerifiedWorkflowExecutionData(row)).rejects.toThrow(
    'Original workflow financial binding'
  )
  await expect(readWorkflowExecutionResultFromLog(row)).rejects.toThrow(
    'Original workflow financial binding'
  )
  expect(mocks.verify).not.toHaveBeenCalled()
  expect(mocks.hydrate).not.toHaveBeenCalled()
})
it('uses the same original-finance and actual result projection for a preserved candidate (archive IO seam)', async () => {
  const output = { exact: ' preserved🔥\n ', toolResults: [{ original: true }] }
  const row = canonicalLogFixture({
    level: 'error',
    startedAt: new Date('2026-01-01'),
    endedAt: new Date('2026-01-02'),
    totalDurationMs: 1,
    executionData: {
      preservedFunctionalArchive: { purpose: 'workflow-archive' },
      hasResponseBlock: true,
      errorMessage: 'original failure',
      trigger: { data: { queuedExecution: { source: 'workflow_execute_api' } } },
    },
  })
  mocks.hydrate.mockImplementationOnce(async (candidate, authorize) => {
    await authorize()
    return {
      ...candidate,
      executionData: { ...candidate.executionData, finalOutput: output, traceSpans: [] },
    }
  })
  const result = await readWorkflowExecutionResultFromLog(row)
  expect(result).toMatchObject({
    status: 'failed',
    failureReason: 'original failure',
    result: {
      success: false,
      output,
      metadata: { hasResponseBlock: true, queuedExecution: { source: 'workflow_execute_api' } },
    },
  })
  expect(mocks.verify).toHaveBeenCalledOnce()
  expect(mocks.hydrate).toHaveBeenCalledWith({ ...row, logId: row.id }, expect.any(Function))
})
