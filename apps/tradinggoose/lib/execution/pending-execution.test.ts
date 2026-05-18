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
  selectLimitMock,
  txExecuteMock,
  updateReturningMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  drainPendingExecutionsForBillingScopeMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  isDevMock: vi.fn(),
  getTriggerExecutionStateMock: vi.fn(),
  andMock: vi.fn((...args) => ({ args })),
  eqMock: vi.fn((field, value) => ({ field, value })),
  selectLimitMock: vi.fn(),
  txExecuteMock: vi.fn(),
  updateReturningMock: vi.fn(),
}))

const txSelectLimitMock = vi.fn()
const txSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: txSelectLimitMock,
}

const txInsertValuesMock = vi.fn()
const txInsertChain = {
  values: txInsertValuesMock,
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

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: transactionMock,
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => ({
      where: deleteWhereMock,
    })),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: {
    id: 'pendingExecution.id',
    billingScopeId: 'pendingExecution.billingScopeId',
    status: 'pendingExecution.status',
    createdAt: 'pendingExecution.createdAt',
    executionType: 'pendingExecution.executionType',
    orderingKey: 'pendingExecution.orderingKey',
    source: 'pendingExecution.source',
    userId: 'pendingExecution.userId',
    workflowId: 'pendingExecution.workflowId',
    workspaceId: 'pendingExecution.workspaceId',
    payload: 'pendingExecution.payload',
    errorMessage: 'pendingExecution.errorMessage',
    processingStartedAt: 'pendingExecution.processingStartedAt',
    updatedAt: 'pendingExecution.updatedAt',
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
  sql: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  get isDev() {
    return isDevMock()
  },
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingContext: vi.fn(),
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

import { cancelPendingWorkflowExecution, enqueuePendingExecution } from './pending-execution'

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
    txInsertValuesMock.mockResolvedValue(undefined)
    updateReturningMock.mockResolvedValue([])
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
      billingScopeId: 'workspace-1',
      inserted: true,
    })
    expect(triggerMock).not.toHaveBeenCalled()
    expect(drainPendingExecutionsForBillingScopeMock).toHaveBeenCalledWith({
      billingScopeId: 'workspace-1',
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
      billingScopeId: 'workspace-1',
      inserted: false,
    })
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('skips rows when the same ordering key already has active work', async () => {
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
      billingScopeId: 'workspace-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
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

describe('cancelPendingWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectChain.from.mockReturnThis()
    selectChain.where.mockReturnThis()
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
    updateReturningMock.mockResolvedValue([])
  })

  it('returns cancelling only when the pending row update matches', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'pending-1',
        status: 'pending',
        payload: {},
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
  })

  it('returns not_found when a worker race removes the pending row', async () => {
    selectLimitMock
      .mockResolvedValueOnce([
        {
          id: 'pending-1',
          status: 'pending',
          payload: {},
          workflowId: 'workflow-1',
        },
      ])
      .mockResolvedValueOnce([])
    updateReturningMock.mockResolvedValueOnce([])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ status: 'not_found' })
  })
})
