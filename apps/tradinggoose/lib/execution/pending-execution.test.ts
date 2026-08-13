/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  triggerMock,
  idempotencyCreateMock,
  executePendingExecutionMock,
  deleteWhereMock,
  getTriggerExecutionStateMock,
  resolveServerExecutionBillingContextMock,
  resolveServerExecutionBillingTierForScopeMock,
  andMock,
  eqMock,
  neMock,
  selectLimitMock,
  txExecuteMock,
  updateReturningMock,
  deleteReturningMock,
  loggingStartMock,
  loggingCompleteWithErrorMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  idempotencyCreateMock: vi.fn(),
  executePendingExecutionMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  getTriggerExecutionStateMock: vi.fn(),
  resolveServerExecutionBillingContextMock: vi.fn(),
  resolveServerExecutionBillingTierForScopeMock: vi.fn(),
  andMock: vi.fn((...args) => ({ args })),
  eqMock: vi.fn((field, value) => ({ field, value })),
  neMock: vi.fn((field, value) => ({ field, value, op: 'ne' })),
  selectLimitMock: vi.fn(),
  txExecuteMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  loggingStartMock: vi.fn(),
  loggingCompleteWithErrorMock: vi.fn(),
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
}))

vi.mock('@trigger.dev/sdk', () => ({
  idempotencyKeys: {
    create: idempotencyCreateMock,
  },
  tasks: {
    trigger: triggerMock,
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
  ne: neMock,
  sql: vi.fn(),
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

vi.mock('@/background/pending-execution-worker', () => ({
  executePendingExecution: executePendingExecutionMock,
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

import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import {
  claimNextPendingExecution,
  completePendingExecution,
  dispatchNextPendingExecution,
  enqueuePendingExecution,
  getPendingExecutionTriggerKey,
  wakePendingExecution,
} from './pending-execution'

const TIMEOUT_NONE = 2_147_483_647
const triggerEnabledState = {
  configurationReady: true,
  triggerDevEnabled: true,
  executionEnabled: true,
}
const directExecutionState = {
  configurationReady: false,
  triggerDevEnabled: false,
  executionEnabled: false,
}

const createPendingRow = (overrides: Record<string, unknown> = {}) => ({
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

describe('dispatchNextPendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingContextMock.mockResolvedValue(null)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
    idempotencyCreateMock.mockResolvedValue('idempotency-key')
    triggerMock.mockResolvedValue(undefined)
    executePendingExecutionMock.mockResolvedValue({ success: true })
    txSelectLimitMock.mockResolvedValue([])
    txExecuteMock.mockResolvedValue(undefined)
    updateReturningMock.mockResolvedValue([])
    updateChain.set.mockReturnThis()
    updateChain.where.mockReturnThis()
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

  it('runs the exact claimed row directly without Trigger.dev duration options', async () => {
    const row = createPendingRow({ id: 'pending-local-1' })
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)
    mockClaimableRow(row)

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: 'pending-local-1',
    })

    expect(executePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-local-1',
    })
    expect(resolveServerExecutionBillingTierForScopeMock).toHaveBeenCalledTimes(1)
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('does not admit a worker when the billing scope queue is empty', async () => {
    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'empty',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('does not admit a worker when the billing scope is at capacity', async () => {
    const row = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 1,
      displayName: 'Starter',
      workflowExecutionTimeLimitSeconds: 45,
    })
    txSelectLimitMock
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])

    await expect(dispatchNextPendingExecution({ billingScopeId: 'scope-1' })).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
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
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([blocked])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([])
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
    executePendingExecutionMock.mockResolvedValue({ success: true })
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

  it('dispatches the exact inserted row directly when Trigger.dev is disabled', async () => {
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockClaimableRow(
      createPendingRow({
        id: 'pending-local-1',
        billingScopeId: 'user-1',
        payload: { executionId: 'pending-local-1' },
      })
    )

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
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-local-1',
    })
    expect(resolveServerExecutionBillingTierForScopeMock).toHaveBeenCalledTimes(1)
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
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockClaimableRow(
      createPendingRow({
        id: 'pending-org-1',
        billingScopeId: 'organization-1',
        billingScopeType: 'organization',
        payload: { executionId: 'pending-org-1' },
      })
    )

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
    expect(executePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-org-1',
    })
  })

  it('returns duplicate pending ids without dispatching another worker', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
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

  it('dispatches the exact existing row when a duplicate ordered row is enqueued', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'pending-schedule-1' }])
    mockClaimableRow(
      createPendingRow({
        id: 'pending-schedule-1',
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

    expect(result.inserted).toBe(false)
    const triggerKey = getPendingExecutionTriggerKey('pending-schedule-1')
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      { pendingExecutionId: 'pending-schedule-1' },
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
        maxDuration: TIMEOUT_NONE,
      }
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
      billingScopeId: 'user-1',
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
      billingScopeId: 'user-1',
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

  it('keeps an ambiguously admitted row processing for recovery', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    triggerMock.mockRejectedValue(new Error('Trigger unavailable'))
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockClaimableRow(createPendingRow({ billingScopeId: 'user-1' }))

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

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing' }))
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
    })
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.billingScopeId', 'scope-1')
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
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
      })
    ).resolves.toEqual({ status: 'cancelling' })
    expect(loggingStartMock).toHaveBeenCalled()
    expect(loggingCompleteWithErrorMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      error: { message: 'Workflow execution was cancelled' },
      billable: false,
    })
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(executePendingExecutionMock).not.toHaveBeenCalled()
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
})
