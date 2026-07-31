/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  triggerMock,
  drainPendingExecutionsForBillingScopeMock,
  deleteWhereMock,
  isDevMock,
  getTriggerExecutionStateMock,
  andMock,
  eqMock,
  neMock,
  selectLimitMock,
  txExecuteMock,
  updateReturningMock,
  deleteReturningMock,
  loggingStartMock,
  loggingCompleteWithErrorMock,
  recordWorkflowCancellationCandidateMock,
  cancelWorkflowExecutionAtomicallyMock,
  captureClaimedWorkflowLifecycleInTransactionMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  drainPendingExecutionsForBillingScopeMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  isDevMock: vi.fn(),
  getTriggerExecutionStateMock: vi.fn(),
  andMock: vi.fn((...args) => ({ args })),
  eqMock: vi.fn((field, value) => ({ field, value })),
  neMock: vi.fn((field, value) => ({ field, value, op: 'ne' })),
  selectLimitMock: vi.fn(),
  txExecuteMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  loggingStartMock: vi.fn(),
  loggingCompleteWithErrorMock: vi.fn(),
  recordWorkflowCancellationCandidateMock: vi.fn(),
  cancelWorkflowExecutionAtomicallyMock: vi.fn(),
  captureClaimedWorkflowLifecycleInTransactionMock: vi.fn(),
}))

const txSelectLimitMock = vi.fn()
const txSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: txSelectLimitMock,
}

const txInsertValuesMock = vi.fn()
const txInsertChain = {
  values: txInsertValuesMock,
  onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
}

const selectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
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
  workflowExecutionTerminal: {
    rootExecutionId: 'workflowExecutionTerminal.rootExecutionId',
    state: 'workflowExecutionTerminal.state',
    result: 'workflowExecutionTerminal.result',
  },
  workflowExecutionDeadline: {
    rootExecutionId: 'workflowExecutionDeadline.rootExecutionId',
  },
  workflowExecutionAttempt: {
    id: 'workflowExecutionAttempt.id',
    rootExecutionId: 'workflowExecutionAttempt.rootExecutionId',
    pendingExecutionId: 'workflowExecutionAttempt.pendingExecutionId',
    attemptNumber: 'workflowExecutionAttempt.attemptNumber',
    processingCompletedAt: 'workflowExecutionAttempt.processingCompletedAt',
  },
  workflowExecutionParticipant: {
    id: 'workflowExecutionParticipant.id',
    attemptId: 'workflowExecutionParticipant.attemptId',
  },
  workflowExecutionOperation: {
    id: 'workflowExecutionOperation.id',
    rootExecutionId: 'workflowExecutionOperation.rootExecutionId',
    state: 'workflowExecutionOperation.state',
  },
  workflowExecutionOutbox: {
    rootExecutionId: 'workflowExecutionOutbox.rootExecutionId',
  },
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    trigger: triggerMock,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: andMock,
  asc: vi.fn(),
  eq: eqMock,
  lte: vi.fn(),
  ne: neMock,
  sql: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  get isDev() {
    return isDevMock()
  },
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingContext: vi.fn(),
  resolveServerExecutionBillingTierForScope: vi.fn(),
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

vi.mock('@/background/pending-execution-drain', () => ({
  drainPendingExecutionsForBillingScope: drainPendingExecutionsForBillingScopeMock,
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

vi.mock('@/lib/execution/workflow-execution-lifecycle-repository', () => ({
  recordWorkflowCancellationCandidate: recordWorkflowCancellationCandidateMock,
  cancelWorkflowExecutionAtomically: cancelWorkflowExecutionAtomicallyMock,
  captureClaimedWorkflowLifecycleInTransaction: captureClaimedWorkflowLifecycleInTransactionMock,
}))

import {
  claimNextPendingExecution,
  completePendingExecution,
  enqueuePendingExecution,
} from './pending-execution'

describe('enqueuePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDevMock.mockReturnValue(true)
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: false,
      triggerDevEnabled: false,
      executionEnabled: false,
    })
    txSelectLimitMock.mockResolvedValue([])
    selectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    captureClaimedWorkflowLifecycleInTransactionMock.mockResolvedValue({
      policy: {
        kind: 'unlimited',
        rootExecutionId: 'pending-1',
        appliedTierId: 'tier-1',
        processingStartedAt: new Date().toISOString(),
      },
      attemptId: 'attempt-1',
      isRoot: true,
    })
    txInsertValuesMock.mockReturnValue(txInsertChain)
    updateReturningMock.mockResolvedValue([])
    deleteReturningMock.mockResolvedValue([])
    deleteWhereMock.mockReturnValue(deleteChain)
    drainPendingExecutionsForBillingScopeMock.mockResolvedValue({
      success: true,
    })
    transactionMock.mockImplementation(async (callback) =>
      callback({
        execute: txExecuteMock,
        select: vi.fn(() => txSelectChain),
        insert: vi.fn(() => txInsertChain),
      })
    )
  })

  it('starts local drain when Trigger.dev is disabled in local development', async () => {
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
      billingScopeId: 'user-1',
      inserted: true,
    })
    expect(triggerMock).not.toHaveBeenCalled()
    expect(drainPendingExecutionsForBillingScopeMock).toHaveBeenCalledWith({
      billingScopeId: 'user-1',
    })
  })

  it('stores the resolved billing scope when billing is enabled', async () => {
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
      billingScopeId: 'organization-1',
      inserted: true,
    })
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pending-org-1',
        billingScopeId: 'organization-1',
        billingScopeType: 'organization',
      })
    )
    expect(drainPendingExecutionsForBillingScopeMock).toHaveBeenCalledWith({
      billingScopeId: 'organization-1',
    })
  })

  it('returns duplicate pending ids without dispatching another worker', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'pending-local-1' }])

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
      billingScopeId: 'user-1',
      inserted: false,
    })
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('wakes the drain when a duplicate ordered row already exists', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'pending-schedule-1' }])

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

    expect(result.inserted).toBe(false)
    expect(triggerMock).toHaveBeenCalledWith('pending-execution-drain', {
      billingScopeId: 'user-1',
    })
  })

  it('returns duplicate workflow execution ids that already have a durable log', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
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
      billingScopeId: 'user-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('wakes the drain when the same ordering key already has active work', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'pending-existing' }])

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
      billingScopeId: 'user-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(triggerMock).toHaveBeenCalledWith('pending-execution-drain', {
      billingScopeId: 'user-1',
    })
  })

  it('deletes a newly inserted row when the Trigger.dev drain dispatch fails', async () => {
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
    triggerMock.mockRejectedValue(new Error('Trigger unavailable'))

    await expect(
      enqueuePendingExecution({
        executionType: 'workflow',
        pendingExecutionId: 'pending-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        source: 'workflow_api',
        payload: {
          executionId: 'pending-1',
        },
      })
    ).rejects.toThrow('Trigger unavailable')

    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.status', 'pending')
    expect(andMock).toHaveBeenCalled()
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
    txExecuteMock.mockResolvedValue([{ now: '2026-07-29T15:47:39.061Z' }])
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
    txSelectLimitMock.mockResolvedValueOnce([pendingRow]).mockResolvedValueOnce([{ count: 1 }])
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
    expect(captureClaimedWorkflowLifecycleInTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStartedAt: new Date('2026-07-29T15:47:39.061Z'),
      })
    )
  })

  it('rejects a malformed database processing-start timestamp', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 2,
      displayName: 'Pro',
    } as any)
    txSelectLimitMock.mockResolvedValueOnce([pendingRow]).mockResolvedValueOnce([{ count: 1 }])
    txExecuteMock.mockResolvedValue([{ now: 'not-a-timestamp' }])

    await expect(claimNextPendingExecution('scope-1')).rejects.toThrow(
      'Database returned an invalid processing-start timestamp'
    )
    expect(updateReturningMock).not.toHaveBeenCalled()
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
    txSelectLimitMock.mockResolvedValueOnce([pendingRow]).mockResolvedValueOnce([{ count: 1 }])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })
    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(neMock).toHaveBeenCalledWith('pendingExecution.source', 'workflow_block')
  })

  it('claims child workflow rows under the parent workflow capacity marker', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    txSelectLimitMock.mockResolvedValueOnce([{ ...pendingRow, source: 'workflow_block' }])
    updateReturningMock.mockResolvedValueOnce([
      {
        ...pendingRow,
        source: 'workflow_block',
        status: 'processing',
        processingStartedAt: new Date(),
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'pending-1',
        source: 'workflow_block',
        status: 'processing',
      }),
    })
    expect(resolveServerExecutionBillingTierForScope).not.toHaveBeenCalled()
  })

  it('claims child workflow rows while older non-child rows wait for capacity', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )
    vi.mocked(resolveServerExecutionBillingTierForScope).mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    } as any)
    txSelectLimitMock
      .mockResolvedValueOnce([pendingRow])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ ...pendingRow, id: 'child-1', source: 'workflow_block' }])
    updateReturningMock.mockResolvedValueOnce([
      {
        ...pendingRow,
        id: 'child-1',
        source: 'workflow_block',
        status: 'processing',
        processingStartedAt: new Date(),
      },
    ])

    await expect(claimNextPendingExecution('scope-1')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'child-1',
        source: 'workflow_block',
        status: 'processing',
      }),
    })
  })
})

describe('completePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteWhereMock.mockReturnValue(deleteChain)
    deleteReturningMock.mockResolvedValue([{ billingScopeId: 'scope-1' }])
    getTriggerExecutionStateMock.mockResolvedValue({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
  })

  it('releases the processing row and wakes the same billing scope', async () => {
    await completePendingExecution({ pendingExecutionId: 'pending-1' })

    expect(deleteReturningMock).toHaveBeenCalledWith({
      billingScopeId: 'pendingExecution.billingScopeId',
    })
    expect(triggerMock).toHaveBeenCalledWith('pending-execution-drain', {
      billingScopeId: 'scope-1',
    })
  })
})
