/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  triggerMock,
  runsListMock,
  idempotencyCreateMock,
  executePendingExecutionJobMock,
  deleteWhereMock,
  getTriggerExecutionStateMock,
  resolveServerExecutionBillingContextMock,
  resolveServerExecutionBillingTierForScopeMock,
  andMock,
  eqMock,
  selectLimitMock,
  txExecuteMock,
  updateReturningMock,
  deleteReturningMock,
  loggingStartMock,
  loggingCompleteWithErrorMock,
  finalizePendingExecutionFailureMock,
  sqlMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  runsListMock: vi.fn(),
  idempotencyCreateMock: vi.fn(),
  executePendingExecutionJobMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  getTriggerExecutionStateMock: vi.fn(),
  resolveServerExecutionBillingContextMock: vi.fn(),
  resolveServerExecutionBillingTierForScopeMock: vi.fn(),
  andMock: vi.fn((...args) => ({ args })),
  eqMock: vi.fn((field, value) => ({ field, value })),
  selectLimitMock: vi.fn(),
  txExecuteMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  loggingStartMock: vi.fn(),
  loggingCompleteWithErrorMock: vi.fn(),
  finalizePendingExecutionFailureMock: vi.fn(),
  sqlMock: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  })),
}))

const txSelectLimitMock = vi.fn()
const txSelectRowsMock = vi.fn().mockResolvedValue([])
const txSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: txSelectLimitMock,
  execute: txSelectRowsMock,
}

const txInsertValuesMock = vi.fn()
const txInsertChain = {
  values: txInsertValuesMock,
}

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  limit: selectLimitMock,
}

const updateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: updateReturningMock,
}

const deleteChain = {
  where: deleteWhereMock,
  returning: deleteReturningMock,
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: transactionMock,
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: {
    id: 'pendingExecution.id',
    billingScopeId: 'pendingExecution.billingScopeId',
    billingScopeType: 'pendingExecution.billingScopeType',
    status: 'pendingExecution.status',
    nextAttemptAt: 'pendingExecution.nextAttemptAt',
    createdAt: 'pendingExecution.createdAt',
    executionType: 'pendingExecution.executionType',
    orderingKey: 'pendingExecution.orderingKey',
    source: 'pendingExecution.source',
    userId: 'pendingExecution.userId',
    workflowId: 'pendingExecution.workflowId',
    workspaceId: 'pendingExecution.workspaceId',
    payload: 'pendingExecution.payload',
    processingStartedAt: 'pendingExecution.processingStartedAt',
    updatedAt: 'pendingExecution.updatedAt',
  },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    executionId: 'workflowExecutionLogs.executionId',
  },
}))

vi.mock('@trigger.dev/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trigger.dev/sdk')>()),
  idempotencyKeys: {
    create: idempotencyCreateMock,
  },
  tasks: {
    trigger: triggerMock,
  },
  runs: {
    list: runsListMock,
  },
  timeout: {
    None: 2_147_483_647,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: andMock,
  asc: vi.fn(),
  eq: eqMock,
  lte: vi.fn(),
  sql: sqlMock,
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingContext: resolveServerExecutionBillingContextMock,
  resolveServerExecutionBillingTierForScope: resolveServerExecutionBillingTierForScopeMock,
}))

vi.mock('@/lib/trigger/settings', () => ({
  getTriggerExecutionState: getTriggerExecutionStateMock,
  TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
    statusCode = 503
    code = 'TRIGGER_EXECUTION_DISABLED'

    constructor(message = 'Trigger.dev execution is disabled or not configured.') {
      super(message)
      this.name = 'TriggerExecutionUnavailableError'
    }
  },
}))

vi.mock('@/background/pending-execution-job', () => ({
  executePendingExecutionJob: executePendingExecutionJobMock,
}))

vi.mock('@/background/pending-execution-worker', () => ({
  finalizePendingExecutionFailure: finalizePendingExecutionFailureMock,
  PENDING_EXECUTION_WORKER_FAILURE_ERROR: 'Workflow execution stopped before it could finish',
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn(function () {
    void new.target
    return {
      start: loggingStartMock,
      completeWithError: loggingCompleteWithErrorMock,
    }
  }),
}))

import { ApiError } from '@trigger.dev/sdk'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import {
  claimNextPendingExecution,
  completePendingExecution,
  dispatchNextPendingExecution,
  enqueuePendingExecution,
  getPendingExecutionTriggerKey,
  markPendingExecutionOwnerCompleted,
  type PendingExecutionClaim,
  wakePendingExecution,
} from './pending-execution'

const TIMEOUT_NONE = 2_147_483_647
const triggerEnabledState = {
  mode: 'trigger',
}
const directExecutionState = {
  mode: 'local',
}

const createPendingRow = (
  overrides: Partial<PendingExecutionClaim> = {}
): PendingExecutionClaim => ({
  id: 'pending-1',
  billingScopeId: 'scope-1',
  billingScopeType: 'user',
  executionType: 'workflow',
  source: 'workflow_api',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  payload: { workflowId: 'workflow-1' },
  status: 'pending',
  nextAttemptAt: new Date(),
  processingStartedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const createTriggerRun = (
  status: string,
  overrides: Partial<{
    id: string
    durationMs: number
    isCompleted: boolean
    isCancelled: boolean
  }> = {}
) => ({
  id: `run-${status.toLowerCase()}`,
  status,
  durationMs: 1_000,
  isCompleted: false,
  isCancelled: false,
  ...overrides,
})

function configureTransactionMock() {
  transactionMock.mockImplementation(async (callback) =>
    callback({
      execute: txExecuteMock,
      select: vi.fn(() => txSelectChain),
      insert: vi.fn(() => txInsertChain),
      update: vi.fn(() => updateChain),
    })
  )
}

function mockClaimableRow(row: ReturnType<typeof createPendingRow>) {
  txSelectLimitMock.mockResolvedValueOnce([row])
  updateReturningMock.mockResolvedValueOnce([
    {
      ...row,
      status: 'processing',
      processingStartedAt: new Date(),
    },
  ])
}

beforeEach(() => {
  txSelectLimitMock.mockReset().mockResolvedValue([])
  txSelectRowsMock.mockReset().mockResolvedValue([])
  selectLimitMock.mockReset().mockResolvedValue([])
  selectChain.orderBy.mockReset().mockResolvedValue([])
  runsListMock.mockReset().mockResolvedValue({ data: [] })
  finalizePendingExecutionFailureMock.mockReset().mockResolvedValue(true)
})

describe('dispatchNextPendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingContextMock.mockResolvedValue(null)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
    idempotencyCreateMock.mockResolvedValue('idempotency-key')
    triggerMock.mockResolvedValue(undefined)
    runsListMock.mockResolvedValue({ data: [] })
    finalizePendingExecutionFailureMock.mockResolvedValue(true)
    executePendingExecutionJobMock.mockResolvedValue({ success: true })
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    updateReturningMock.mockResolvedValue([])
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    deleteWhereMock.mockReturnValue(deleteChain)
    deleteReturningMock.mockResolvedValue([])
    configureTransactionMock()
  })

  it('maps a finite tier workflow limit onto the exact Trigger.dev run', async () => {
    const row = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: null,
      displayName: 'Pro',
      workflowExecutionTimeLimitSeconds: 45,
    })
    mockClaimableRow(row)

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: 'pending-1',
    })

    const triggerKey = getPendingExecutionTriggerKey('pending-1')
    expect(triggerKey).toMatch(/^pending-execution:[a-f0-9]{64}$/)
    expect(idempotencyCreateMock).toHaveBeenCalledWith(triggerKey, { scope: 'global' })
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-1' },
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
        maxDuration: 45,
      }
    )
  })

  it('maps a null tier workflow limit to timeout.None', async () => {
    const row = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: null,
      displayName: 'Unlimited',
      workflowExecutionTimeLimitSeconds: null,
    })
    mockClaimableRow(row)

    await dispatchNextPendingExecution({ billingScopeId: 'scope-1' })

    const triggerKey = getPendingExecutionTriggerKey('pending-1')
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-1' },
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
        maxDuration: TIMEOUT_NONE,
      }
    )
  })

  it('leaves indicator calculation on its existing intrinsic timeout', async () => {
    const row = createPendingRow({
      executionType: 'monitor',
      source: 'monitor:indicator:calculation',
      payload: { monitorId: 'indicator-monitor-1' },
    })
    mockClaimableRow(row)

    await dispatchNextPendingExecution({ billingScopeId: 'scope-1' })

    const triggerKey = getPendingExecutionTriggerKey('pending-1')
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-1' },
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
      }
    )
    expect(triggerMock.mock.calls[0]?.[2]).not.toHaveProperty('maxDuration')
  })

  it('does not inspect the Trigger queue in local mode', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'empty',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('does not admit a worker when the billing scope queue is empty', async () => {
    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'empty',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionJobMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('does not admit a worker when the billing scope is at capacity', async () => {
    const row = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    const processing = createPendingRow({ id: 'processing-1', status: 'processing' })
    txSelectLimitMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
    txSelectRowsMock
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
    selectChain.orderBy.mockResolvedValueOnce([processing])
    runsListMock.mockResolvedValueOnce({
      data: [createTriggerRun('WAITING', { id: 'run-processing-1' })],
    })

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionJobMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
    expect(runsListMock).toHaveBeenCalledOnce()
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
    expect(deleteReturningMock).not.toHaveBeenCalled()
    expect(txExecuteMock).toHaveBeenCalledTimes(2)
  })

  it('releases terminal capacity and retries the blocked claim once', async () => {
    const pending = createPendingRow()
    const grandparent = createPendingRow({ id: 'grandparent-1', status: 'processing' })
    const parent = createPendingRow({
      id: 'parent-1',
      status: 'processing',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: grandparent.id } },
    })
    const borrowedChild = createPendingRow({
      id: 'child-1',
      status: 'processing',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: parent.id } },
    })
    const processing = createPendingRow({
      id: 'processing-1',
      status: 'processing',
      processingStartedAt: new Date('2026-08-18T12:00:00.000Z'),
    })
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    txSelectLimitMock.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending])
    txSelectRowsMock
      .mockResolvedValueOnce([
        { id: grandparent.id, source: grandparent.source, payload: grandparent.payload },
        { id: parent.id, source: parent.source, payload: parent.payload },
        { id: borrowedChild.id, source: borrowedChild.source, payload: borrowedChild.payload },
        { id: processing.id, source: processing.source, payload: {} },
      ])
      .mockResolvedValueOnce([])
    selectLimitMock.mockResolvedValueOnce([grandparent])
    selectChain.orderBy.mockResolvedValueOnce([grandparent, parent, borrowedChild, processing])
    runsListMock
      .mockResolvedValueOnce({
        data: [createTriggerRun('WAITING', { id: 'run-grandparent-1' })],
      })
      .mockResolvedValueOnce({
        data: [createTriggerRun('WAITING', { id: 'run-parent-1' })],
      })
      .mockResolvedValueOnce({
        data: [
          createTriggerRun('TIMED_OUT', {
            id: 'run-child-1',
            durationMs: 10_000,
            isCompleted: true,
          }),
        ],
      })
      .mockResolvedValueOnce({
        data: [
          createTriggerRun('TIMED_OUT', {
            id: 'run-processing-1',
            durationMs: 45_000,
            isCompleted: true,
          }),
        ],
      })
    updateReturningMock.mockResolvedValueOnce([
      { ...pending, status: 'processing', processingStartedAt: new Date() },
    ])

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: pending.id,
    })

    expect(finalizePendingExecutionFailureMock).toHaveBeenNthCalledWith(
      1,
      borrowedChild,
      'Workflow execution time limit exceeded',
      10_000,
      { wake: false }
    )
    expect(finalizePendingExecutionFailureMock).toHaveBeenNthCalledWith(
      2,
      processing,
      'Workflow execution time limit exceeded',
      45_000,
      { wake: false }
    )
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', grandparent.id)
    expect(selectChain.where).toHaveBeenCalledWith({
      args: [
        { field: 'pendingExecution.billingScopeId', value: 'scope-1' },
        { field: 'pendingExecution.status', value: 'processing' },
      ],
    })
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: pending.id },
      expect.anything()
    )
  })

  it('retries a processing row whose Trigger admission is missing', async () => {
    const pending = createPendingRow()
    const processing = createPendingRow({ id: 'processing-1', status: 'processing' })
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    txSelectLimitMock.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending])
    txSelectRowsMock
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
    selectChain.orderBy.mockResolvedValueOnce([processing])

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: pending.id,
    })

    expect(triggerMock).toHaveBeenCalledOnce()
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: processing.id },
      expect.objectContaining({ maxDuration: 45 })
    )
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
  })

  it('retains a completed parent while its child still owns borrowed capacity', async () => {
    const pending = createPendingRow()
    const processing = createPendingRow({ id: 'processing-1', status: 'processing' })
    const child = createPendingRow({
      id: 'child-1',
      status: 'processing',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: processing.id } },
    })
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    txSelectLimitMock.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending])
    txSelectRowsMock
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
    const completedProcessing = {
      ...processing,
      payload: { ownerCompletedAt: '2026-08-18T12:00:00.000Z' },
    }
    selectLimitMock
      .mockResolvedValueOnce([completedProcessing])
      .mockResolvedValueOnce([completedProcessing])
    selectChain.orderBy
      .mockResolvedValueOnce([processing])
      .mockResolvedValueOnce([child])
      .mockResolvedValueOnce([child])
    runsListMock.mockResolvedValueOnce({
      data: [createTriggerRun('COMPLETED', { id: 'run-processing-1', isCompleted: true })],
    })

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: pending.id,
    })

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) })
    )
    expect(deleteReturningMock).not.toHaveBeenCalled()
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
  })

  it('retries the claim when the last child finishes while its parent is being marked', async () => {
    const pending = createPendingRow()
    const processing = createPendingRow({ id: 'processing-1', status: 'processing' })
    const child = createPendingRow({
      id: 'child-1',
      status: 'processing',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: processing.id } },
    })
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    txSelectLimitMock.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending])
    txSelectRowsMock
      .mockResolvedValueOnce([{ id: processing.id, source: processing.source, payload: {} }])
      .mockResolvedValueOnce([])
    selectLimitMock.mockResolvedValueOnce([
      {
        ...processing,
        payload: { ownerCompletedAt: '2026-08-18T12:00:00.000Z' },
      },
    ])
    selectChain.orderBy
      .mockResolvedValueOnce([processing])
      .mockResolvedValueOnce([child])
      .mockResolvedValueOnce([])
    runsListMock.mockResolvedValueOnce({
      data: [createTriggerRun('COMPLETED', { id: 'run-processing-1', isCompleted: true })],
    })
    deleteReturningMock.mockResolvedValueOnce([
      { billingScopeId: processing.billingScopeId, parentExecutionId: null },
    ])
    updateReturningMock.mockResolvedValueOnce([
      { ...pending, status: 'processing', processingStartedAt: new Date() },
    ])

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: pending.id,
    })

    expect(deleteReturningMock).toHaveBeenCalledOnce()
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: pending.id },
      expect.anything()
    )
  })
})

describe('wakePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 2,
      displayName: 'Pro',
      workflowExecutionTimeLimitSeconds: 45,
    })
    idempotencyCreateMock.mockResolvedValue('idempotency-key')
    triggerMock.mockResolvedValue(undefined)
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    updateReturningMock.mockResolvedValue([])
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    configureTransactionMock()
  })

  it('fills every available concurrency slot before stopping at the tier gate', async () => {
    const first = createPendingRow({ id: 'pending-1' })
    const second = createPendingRow({ id: 'pending-2' })
    const blocked = createPendingRow({ id: 'pending-3' })
    txSelectLimitMock
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([blocked])
    txSelectRowsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: first.id, source: first.source, payload: first.payload }])
      .mockResolvedValueOnce([
        { id: first.id, source: first.source, payload: first.payload },
        { id: second.id, source: second.source, payload: second.payload },
      ])
    updateReturningMock
      .mockResolvedValueOnce([{ ...first, status: 'processing' }])
      .mockResolvedValueOnce([{ ...second, status: 'processing' }])

    await wakePendingExecution({ billingScopeId: 'scope-1' })

    expect(triggerMock).toHaveBeenCalledTimes(2)
    expect(triggerMock.mock.calls.map((call) => call[1])).toEqual([
      { pendingExecutionId: 'pending-1' },
      { pendingExecutionId: 'pending-2' },
    ])
    expect(updateReturningMock).toHaveBeenCalledTimes(2)
    expect(getTriggerExecutionStateMock).toHaveBeenCalledOnce()
  })
})

describe('enqueuePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)
    resolveServerExecutionBillingContextMock.mockResolvedValue(null)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
    idempotencyCreateMock.mockResolvedValue('idempotency-key')
    triggerMock.mockResolvedValue(undefined)
    executePendingExecutionJobMock.mockResolvedValue({ success: true })
    txSelectLimitMock.mockResolvedValue([])
    selectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    txInsertValuesMock.mockResolvedValue(undefined)
    updateReturningMock.mockResolvedValue([])
    deleteReturningMock.mockResolvedValue([])
    deleteWhereMock.mockReturnValue(deleteChain)
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    configureTransactionMock()
  })

  it('executes streamed local work directly without queue or billing gates', async () => {
    const result = await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'pending-local-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: {
        executionId: 'pending-local-1',
        stream: true,
      },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-local-1',
      inserted: true,
    })
    expect(triggerMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionJobMock).toHaveBeenCalledWith(
      {
        id: 'pending-local-1',
        executionType: 'workflow',
        payload: { executionId: 'pending-local-1', stream: true },
      },
      { triggerRuntime: false }
    )
    expect(transactionMock).toHaveBeenCalledOnce()
    expect(txExecuteMock).toHaveBeenCalledOnce()
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(resolveServerExecutionBillingContextMock).not.toHaveBeenCalled()
    expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
  })

  it('propagates direct local failures without leaving a queue row', async () => {
    executePendingExecutionJobMock.mockRejectedValueOnce(new Error('Local workflow failed'))

    await expect(
      enqueuePendingExecution({
        executionType: 'workflow',
        pendingExecutionId: 'pending-local-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        source: 'workflow_api',
        payload: { executionId: 'pending-local-1' },
      })
    ).rejects.toThrow('Local workflow failed')

    expect(executePendingExecutionJobMock).toHaveBeenCalledOnce()
    expect(txInsertValuesMock).not.toHaveBeenCalled()
  })

  it('processes local documents directly without Trigger', async () => {
    const payload = { documentId: 'document-1', knowledgeBaseId: 'knowledge-1' }

    await enqueuePendingExecution({
      executionType: 'document',
      pendingExecutionId: 'document-local-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'document_processing',
      payload,
    })

    expect(executePendingExecutionJobMock).toHaveBeenCalledWith(
      { id: 'document-local-1', executionType: 'document', payload },
      { triggerRuntime: false }
    )
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('stores the resolved billing scope when billing is enabled', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    const { resolveServerExecutionBillingContext } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingContext).mockResolvedValueOnce({
      scopeId: 'organization-1',
      scopeType: 'organization',
      tier: {
        maxPendingAgeSeconds: null,
        maxPendingCount: null,
      },
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'pending-org-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: {
        executionId: 'pending-org-1',
      },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-org-1',
      inserted: true,
    })
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pending-org-1',
        billingScopeId: 'organization-1',
        billingScopeType: 'organization',
      })
    )
    expect(executePendingExecutionJobMock).not.toHaveBeenCalled()
  })

  it('wakes a duplicate pending execution through the normal scope drain', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'pending-local-1' }])
    mockClaimableRow(createPendingRow({ id: 'pending-local-1', billingScopeId: 'user-1' }))

    const result = await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'pending-local-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: {
        executionId: 'pending-local-1',
      },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-local-1',
      inserted: false,
    })
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-local-1' },
      expect.anything()
    )
  })

  it('returns duplicate workflow execution ids that already have a durable log', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'log-1' }])

    const result = await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: {
        executionId: 'execution-1',
      },
    })

    expect(result).toEqual({
      pendingExecutionId: 'execution-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('dispatches the exact active ordering row when the same ordering key is enqueued', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'pending-existing' }])
    mockClaimableRow(
      createPendingRow({
        id: 'pending-existing',
        executionType: 'schedule',
        source: 'schedule',
        billingScopeId: 'user-1',
      })
    )

    const result = await enqueuePendingExecution({
      executionType: 'schedule',
      pendingExecutionId: 'pending-schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'schedule',
      orderingKey: 'schedule:schedule-1',
      payload: {
        executionId: 'pending-schedule-1',
      },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-schedule-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    const triggerKey = getPendingExecutionTriggerKey('pending-existing')
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-existing' },
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
        maxDuration: TIMEOUT_NONE,
      }
    )
  })

  it.each([
    ['ambiguous', new Error('Trigger unavailable'), false],
    ['rejected', new ApiError(400, undefined, 'Invalid task payload', undefined), true],
  ])('keeps the new row queued after an %s dispatch failure', async (_, error, resetClaim) => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    triggerMock.mockRejectedValue(error)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockClaimableRow(createPendingRow({ id: 'pending-a', billingScopeId: 'user-1' }))

    await expect(
      enqueuePendingExecution({
        executionType: 'workflow',
        pendingExecutionId: 'pending-b',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        source: 'workflow_api',
        payload: {
          executionId: 'pending-b',
        },
      })
    ).rejects.toThrow(error.message)

    expect(txInsertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-b' }))
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-a' },
      expect.anything()
    )
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing' }))
    expect(deleteWhereMock).not.toHaveBeenCalled()
    if (resetClaim) {
      expect(updateChain.set).toHaveBeenCalledWith({
        status: 'pending',
        processingStartedAt: null,
        updatedAt: expect.any(Date),
      })
      expect(andMock).toHaveBeenCalledWith(
        { field: 'pendingExecution.id', value: 'pending-a' },
        { field: 'pendingExecution.status', value: 'processing' }
      )
    } else {
      expect(updateChain.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      )
    }
  })
})

describe('claimNextPendingExecution', () => {
  const pendingRow = {
    id: 'pending-1',
    billingScopeId: 'scope-1',
    billingScopeType: 'user',
    executionType: 'workflow',
    source: 'workflow_api',
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    payload: { workflowId: 'workflow-1' },
    status: 'pending',
    nextAttemptAt: new Date(),
    processingStartedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    updateReturningMock.mockResolvedValue([])
    transactionMock.mockImplementation(async (callback) =>
      callback({
        execute: txExecuteMock,
        select: vi.fn(() => txSelectChain),
        update: vi.fn(() => updateChain),
      })
    )
  })

  it('claims the earliest pending row when the billing scope has capacity', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 2,
      displayName: 'Pro',
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([pendingRow])
    txSelectRowsMock.mockResolvedValueOnce([
      { id: 'processing-1', source: 'workflow_api', payload: {} },
    ])
    updateReturningMock.mockResolvedValueOnce([
      {
        ...pendingRow,
        status: 'processing',
        processingStartedAt: new Date(),
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'pending-1',
        payload: { workflowId: 'workflow-1' },
        status: 'processing',
      }),
    })
  })

  it('claims pending rows without a capacity check when local billing tier resolution is unavailable', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce(null)
    txSelectLimitMock.mockResolvedValueOnce([pendingRow])
    updateReturningMock.mockResolvedValueOnce([
      {
        ...pendingRow,
        status: 'processing',
        processingStartedAt: new Date(),
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'pending-1',
        status: 'processing',
      }),
    })

    expect(resolveServerExecutionBillingTierForScope).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      scopeType: 'user',
    })
    expect(txSelectLimitMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the earliest pending row queued when the billing scope is full', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([pendingRow])
    txSelectRowsMock.mockResolvedValueOnce([
      { id: 'processing-1', source: 'workflow_api', payload: {} },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })
    expect(updateReturningMock).not.toHaveBeenCalled()
  })

  it('prioritizes a runnable child over an older orphan under the parent capacity marker', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    } as any)
    const orphanChild = {
      ...pendingRow,
      id: 'orphan-child',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: 'missing-parent' } },
      createdAt: new Date(0),
    }
    const childRow = {
      ...pendingRow,
      id: 'runnable-child',
      source: 'workflow_block',
      payload: { metadata: { parentExecutionId: 'parent-1' } },
      createdAt: new Date(1),
    }
    let activeParentWasPrioritized = false
    txSelectChain.orderBy.mockImplementationOnce((priority: { strings?: string[] }) => {
      activeParentWasPrioritized = priority.strings?.join('').includes('exists') ?? false
      return txSelectChain
    })
    txSelectLimitMock.mockImplementationOnce(async () => [
      activeParentWasPrioritized ? childRow : orphanChild,
    ])
    txSelectRowsMock.mockResolvedValueOnce([
      { id: 'parent-1', source: 'workflow_api', payload: {} },
    ])
    updateReturningMock.mockResolvedValueOnce([
      {
        ...childRow,
        status: 'processing',
        processingStartedAt: new Date(),
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'runnable-child',
        source: 'workflow_block',
        status: 'processing',
      }),
    })
    expect(resolveServerExecutionBillingTierForScope).toHaveBeenCalledOnce()
    expect(
      sqlMock.mock.calls.some(([strings]) => strings.join('').includes('parent_pending_execution'))
    ).toBe(true)
  })

  it('counts a child without a processing same-scope parent against capacity', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([
      {
        ...pendingRow,
        id: 'child-1',
        source: 'workflow_block',
        payload: { metadata: { parentExecutionId: 'missing-parent' } },
      },
    ])
    txSelectRowsMock.mockResolvedValueOnce([
      { id: 'processing-1', source: 'workflow_api', payload: {} },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'child-1',
    })
    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(sqlMock.mock.calls.some(([strings]) => strings.join('').includes('case when'))).toBe(
      true
    )
  })

  it('counts an already-processing child whose parent row is absent', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([pendingRow])
    txSelectRowsMock.mockResolvedValueOnce([
      {
        id: 'orphan-child',
        source: 'workflow_block',
        payload: { metadata: { parentExecutionId: 'missing-parent' } },
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })
    expect(updateReturningMock).not.toHaveBeenCalled()
  })
})

describe('completePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteWhereMock.mockReturnValue(deleteChain)
    deleteReturningMock.mockResolvedValue([{ billingScopeId: 'scope-1' }])
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    configureTransactionMock()
  })

  it('releases the processing row without admitting work from an empty billing scope', async () => {
    await completePendingExecution({ pendingExecutionId: 'pending-1' })

    expect(deleteReturningMock).toHaveBeenCalledWith({
      billingScopeId: 'pendingExecution.billingScopeId',
      parentExecutionId: expect.anything(),
    })
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.billingScopeId', 'scope-1')
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionJobMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('can settle reconciliation without recursively waking the billing scope', async () => {
    await completePendingExecution({ pendingExecutionId: 'pending-1', wake: false })

    expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('releases completed ancestors after the last nested child is removed', async () => {
    deleteReturningMock
      .mockResolvedValueOnce([
        {
          billingScopeId: 'scope-1',
          parentExecutionId: 'parent-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          billingScopeId: 'scope-1',
          parentExecutionId: 'grandparent-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          billingScopeId: 'scope-1',
          parentExecutionId: null,
        },
      ])
    selectLimitMock
      .mockResolvedValueOnce([
        createPendingRow({
          id: 'parent-1',
          status: 'processing',
          payload: { ownerCompletedAt: '2026-01-01T00:00:00.000Z' },
        }),
      ])
      .mockResolvedValueOnce([
        createPendingRow({
          id: 'grandparent-1',
          status: 'processing',
          payload: { ownerCompletedAt: '2026-01-01T00:00:00.000Z' },
        }),
      ])

    await completePendingExecution({ pendingExecutionId: 'child-1', wake: false })

    expect(deleteReturningMock).toHaveBeenCalledTimes(3)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'parent-1')
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'grandparent-1')
    expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
  })
})

describe('markPendingExecutionOwnerCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    deleteWhereMock.mockReturnValue(deleteChain)
    deleteReturningMock.mockResolvedValue([])
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)
  })

  it('atomically merges the owner marker into the current database payload', async () => {
    await markPendingExecutionOwnerCompleted(
      createPendingRow({
        status: 'processing',
        payload: { cancelRequestedAt: '2026-01-01T00:00:00.000Z' },
      })
    )

    expect(sqlMock.mock.calls[0]?.[0].join('')).toContain("jsonb_build_object('ownerCompletedAt'")
    expect(sqlMock.mock.calls[0]?.[1]).toBe('pendingExecution.payload')
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ payload: sqlMock.mock.results[0]?.value })
    )
  })

  it('removes the owner when its last child finished before the marker was written', async () => {
    selectLimitMock.mockResolvedValueOnce([
      createPendingRow({
        id: 'parent-1',
        status: 'processing',
        payload: { ownerCompletedAt: '2026-01-01T00:00:00.000Z' },
      }),
    ])
    deleteReturningMock.mockResolvedValueOnce([
      {
        billingScopeId: 'scope-1',
        parentExecutionId: null,
      },
    ])

    await markPendingExecutionOwnerCompleted(
      createPendingRow({ id: 'parent-1', status: 'processing' })
    )

    expect(deleteReturningMock).toHaveBeenCalledOnce()
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'parent-1')
  })
})

describe('cancelPendingWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectChain.from.mockReturnThis()
    selectChain.where.mockReturnThis()
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    updateReturningMock.mockResolvedValue([])
    deleteWhereMock.mockReturnValue(deleteChain)
    deleteReturningMock.mockResolvedValue([])
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    configureTransactionMock()
    loggingStartMock.mockResolvedValue('log-1')
    loggingCompleteWithErrorMock.mockResolvedValue(undefined)
  })

  it('records queued workflow cancellation before completing the pending row', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'pending-1',
        status: 'pending',
        payload: { triggerType: 'manual' },
        workflowId: 'workflow-1',
      },
    ])
    updateReturningMock.mockResolvedValueOnce([
      {
        id: 'pending-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        payload: { triggerType: 'manual' },
      },
    ])
    deleteReturningMock.mockResolvedValueOnce([{ billingScopeId: 'scope-1' }])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
        wake: false,
      })
    ).resolves.toEqual({ status: 'cancelling' })
    expect(loggingStartMock).toHaveBeenCalled()
    expect(loggingCompleteWithErrorMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      error: { message: 'Workflow execution was cancelled' },
      billable: false,
    })
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionJobMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('returns not_found when a worker race removes the pending row', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'pending-1',
        status: 'pending',
        payload: {},
        workflowId: 'workflow-1',
      },
    ])
    updateReturningMock.mockResolvedValueOnce([])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('atomically merges cancellation into a processing row payload', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'pending-1',
        status: 'processing',
        payload: { ownerCompletedAt: '2026-01-01T00:00:00.000Z' },
        workflowId: 'workflow-1',
      },
    ])
    updateReturningMock.mockResolvedValueOnce([{ id: 'pending-1' }])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ status: 'cancelling' })

    expect(sqlMock.mock.calls[0]?.[0].join('')).toContain("jsonb_build_object('cancelRequestedAt'")
    expect(sqlMock.mock.calls[0]?.[1]).toBe('pendingExecution.payload')
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ payload: sqlMock.mock.results[0]?.value })
    )
  })
})
