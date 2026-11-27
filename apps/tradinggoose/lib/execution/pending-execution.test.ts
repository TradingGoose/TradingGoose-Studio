/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  triggerMock,
  detachedTriggerMock,
  wakeDelayMock,
  runsListMock,
  runsRetrieveMock,
  runsCancelMock,
  idempotencyCreateMock,
  dispatchBackgroundExecutionMock,
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
  finalizePendingExecutionFailureMock,
  terminalizeWorkflowExecutionMock,
  cancelPendingExecutionDescendantsMock,
  readWorkflowCheckpointChildrenMock,
  authorizeWorkflowScopeMock,
  checkWorkspaceAccessMock,
  sqlMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  detachedTriggerMock: vi.fn(),
  wakeDelayMock: vi.fn(),
  runsListMock: vi.fn(),
  runsRetrieveMock: vi.fn(),
  runsCancelMock: vi.fn(),
  idempotencyCreateMock: vi.fn(),
  dispatchBackgroundExecutionMock: vi.fn(),
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
  finalizePendingExecutionFailureMock: vi.fn(),
  terminalizeWorkflowExecutionMock: vi.fn(),
  cancelPendingExecutionDescendantsMock: vi.fn(),
  readWorkflowCheckpointChildrenMock: vi.fn(),
  authorizeWorkflowScopeMock: vi.fn(),
  checkWorkspaceAccessMock: vi.fn(),
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
  for: vi.fn().mockReturnThis(),
  limit: txSelectLimitMock,
  execute: txSelectRowsMock,
}

const txInsertValuesMock = vi.fn()
const txInsertReturningMock = vi.fn()
const txInsertChain = {
  values: txInsertValuesMock,
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: txInsertReturningMock,
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

vi.mock('@/lib/knowledge/documents/local-heartbeat', () => ({
  armLocalDocument: vi.fn(async () => 'local-nonce'),
  disarmLocalDocument: vi.fn(),
}))

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
    workflowId: 'workflowExecutionLogs.workflowId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    executionData: 'workflowExecutionLogs.executionData',
  },
}))

vi.mock('@trigger.dev/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trigger.dev/sdk')>()),
  task: (config: unknown) => config,
  TriggerClient: class {
    tasks = { trigger: detachedTriggerMock }
  },
  wait: { for: wakeDelayMock },
  idempotencyKeys: {
    create: idempotencyCreateMock,
  },
  tasks: {
    trigger: triggerMock,
  },
  runs: {
    cancel: runsCancelMock,
    list: runsListMock,
    retrieve: runsRetrieveMock,
  },
  timeout: {
    None: 2_147_483_647,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: andMock,
  or: andMock,
  asc: vi.fn(),
  eq: eqMock,
  lte: vi.fn(),
  ne: vi.fn((field, value) => ({ field, value, operator: 'ne' })),
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

vi.mock('@/lib/execution/background-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/background-execution')>()),
  dispatchBackgroundExecution: dispatchBackgroundExecutionMock,
}))

vi.mock('@/background/pending-execution-worker', () => ({
  finalizePendingExecutionFailure: finalizePendingExecutionFailureMock,
  terminalizeWorkflowExecution: terminalizeWorkflowExecutionMock,
  cancelPendingExecutionDescendants: cancelPendingExecutionDescendantsMock,
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: authorizeWorkflowScopeMock }))
vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  readWorkflowCheckpointChildren: readWorkflowCheckpointChildrenMock,
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: checkWorkspaceAccessMock }))

import { ApiError } from '@trigger.dev/sdk'
import {
  cancelPendingWorkflowExecution,
  waitForPendingWorkflowExecutionDrain,
} from '@/lib/workflows/queued-execution-cancellation'
import {
  claimNextPendingExecution,
  completePendingExecution,
  dispatchNextPendingExecution,
  enqueuePendingExecution,
  finalizeCancelledPendingWorkflow,
  isWorkflowPendingExecution,
  listChildPendingWorkflowExecutions,
  type PendingExecutionClaim,
  prepareWorkflowDispatch,
  reconcileStoppedWorkflowOwner,
  requestCancelledWorkflowSettlement,
  settlePendingExecutionOwner,
  wakePendingExecution,
  withPendingWorkflowExecution,
} from './pending-execution'

const TIMEOUT_NONE = 2_147_483_647
const triggerEnabledState = {
  mode: 'trigger',
}
const directExecutionState = {
  mode: 'local',
}

const userBillingScope = { billingScopeId: 'scope-1', billingScopeType: 'user' }

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

const createSupervisorPayload = (
  row: Pick<PendingExecutionClaim, 'id' | 'billingScopeId' | 'billingScopeType' | 'executionType'>,
  executionMaxDuration?: number
) => ({
  pendingExecutionId: row.id,
  billingScopeId: row.billingScopeId,
  billingScopeType: row.billingScopeType,
  executionType: row.executionType,
  ...(executionMaxDuration === undefined ? {} : { executionMaxDuration }),
})

const createTriggerRun = (
  status: string,
  isCompleted: boolean,
  overrides: Partial<{
    durationMs: number
    startedAt: Date
  }> = {}
) => ({
  status,
  isCompleted,
  durationMs: 1_000,
  ...overrides,
})

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
  vi.clearAllMocks()
  txSelectLimitMock.mockReset().mockResolvedValue([])
  txSelectRowsMock.mockReset().mockResolvedValue([])
  selectLimitMock.mockReset().mockResolvedValue([])
  selectChain.orderBy.mockReset().mockResolvedValue([])
  runsListMock.mockReset().mockResolvedValue({ data: [] })
  runsRetrieveMock.mockReset()
  runsCancelMock.mockReset().mockResolvedValue(undefined)
  finalizePendingExecutionFailureMock.mockReset()
  getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
  resolveServerExecutionBillingContextMock.mockResolvedValue(null)
  resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
  idempotencyCreateMock.mockResolvedValue('idempotency-key')
  triggerMock.mockResolvedValue(undefined)
  txExecuteMock.mockResolvedValue(undefined)
  updateReturningMock.mockResolvedValue([])
  deleteWhereMock.mockReturnValue(deleteChain)
  deleteReturningMock.mockResolvedValue([])
  transactionMock.mockImplementation(async (callback) =>
    callback({
      execute: txExecuteMock,
      select: vi.fn(() => txSelectChain),
      insert: vi.fn(() => txInsertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    })
  )
})

describe('dispatchNextPendingExecution', () => {
  it.each([
    { executionType: 'workflow', source: 'workflow_api', maxDuration: 45 },
    { executionType: 'monitor', source: 'monitor:portfolio', maxDuration: 45 },
    { executionType: 'monitor', source: 'monitor:indicator:calculation', maxDuration: 45 },
    { executionType: 'document', source: 'document_processing', maxDuration: 45 },
  ] as const)('applies the duration policy for $source', async ({ maxDuration, ...overrides }) => {
    const row = createPendingRow(overrides)
    expect(isWorkflowPendingExecution(row)).toBe(
      row.executionType === 'workflow' || row.source === 'monitor:portfolio'
    )
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: null,
      displayName: 'Pro',
      workflowExecutionTimeLimitSeconds: 45,
    })
    mockClaimableRow(row)

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: 'pending-1',
    })

    const triggerKey = idempotencyCreateMock.mock.calls[0]?.[0]
    expect(triggerKey).toMatch(/^pending-execution:[a-f0-9]{64}$/)
    expect(idempotencyCreateMock).toHaveBeenCalledWith(triggerKey, { scope: 'global' })
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(row, maxDuration),
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
      }
    )
  })

  it('passes timeout.None to the supervisor for an unlimited tier', async () => {
    const row = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: null,
      displayName: 'Unlimited',
      workflowExecutionTimeLimitSeconds: null,
    })
    mockClaimableRow(row)

    await dispatchNextPendingExecution(userBillingScope)

    const triggerKey = idempotencyCreateMock.mock.calls[0]?.[0]
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(row, TIMEOUT_NONE),
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
      }
    )
  })

  it('accepts an ambiguously acknowledged admission when the tagged run exists', async () => {
    const row = createPendingRow()
    const error = new Error('Trigger admission response was lost')
    mockClaimableRow(row)
    selectLimitMock.mockResolvedValueOnce([{ ...row, status: 'processing' }])
    triggerMock.mockRejectedValueOnce(error)
    runsListMock.mockResolvedValueOnce({ data: [createTriggerRun('EXECUTING', false)] })

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: row.id,
    })

    expect(triggerMock).toHaveBeenCalledOnce()
    const triggerKey = idempotencyCreateMock.mock.calls[0]?.[0]
    expect(runsListMock).toHaveBeenCalledWith({
      tag: triggerKey,
      taskIdentifier: 'pending-execution',
      limit: 1,
    })
    expect(updateChain.set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
  })

  it('retries the exact admission when an ambiguous response has no tagged run', async () => {
    const row = createPendingRow()
    const error = new Error('Trigger admission response was lost')
    mockClaimableRow(row)
    selectLimitMock.mockResolvedValueOnce([{ ...row, status: 'processing' }])
    triggerMock.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: row.id,
    })

    expect(triggerMock).toHaveBeenCalledTimes(2)
    expect(triggerMock.mock.calls[1]).toEqual(triggerMock.mock.calls[0])
    expect(updateChain.set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
  })

  it('does not inspect the Trigger queue in local mode', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'empty',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('does not admit a worker when the billing scope queue is empty', async () => {
    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'empty',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
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
      data: [createTriggerRun('WAITING', false)],
    })

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })

    expect(updateReturningMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
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
      payload: { metadata: { parentPendingExecutionId: grandparent.id } },
    })
    const borrowedChild = createPendingRow({
      id: 'child-1',
      status: 'processing',
      source: 'workflow_block',
      payload: { metadata: { parentPendingExecutionId: parent.id } },
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
        data: [createTriggerRun('WAITING', false)],
      })
      .mockResolvedValueOnce({
        data: [createTriggerRun('WAITING', false)],
      })
      .mockResolvedValueOnce({
        data: [
          createTriggerRun('EXPIRED', true, {
            durationMs: 10_000,
          }),
        ],
      })
      .mockResolvedValueOnce({
        data: [
          createTriggerRun('SYSTEM_FAILURE', true, {
            durationMs: 45_000,
          }),
        ],
      })
    updateReturningMock.mockResolvedValueOnce([
      { ...pending, status: 'processing', processingStartedAt: new Date() },
    ])

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: pending.id,
    })

    expect(finalizePendingExecutionFailureMock).toHaveBeenNthCalledWith(
      1,
      borrowedChild,
      'Workflow execution expired before it started',
      10_000
    )
    expect(finalizePendingExecutionFailureMock).toHaveBeenNthCalledWith(
      2,
      processing,
      'Workflow execution stopped before it could finish',
      45_000
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
      createSupervisorPayload(pending, 45),
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

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: pending.id,
    })

    expect(triggerMock).toHaveBeenCalledOnce()
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(processing, 45),
      expect.not.objectContaining({ maxDuration: expect.anything() })
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
      payload: { metadata: { parentPendingExecutionId: processing.id } },
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
      data: [createTriggerRun('COMPLETED', true)],
    })

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
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
      payload: { metadata: { parentPendingExecutionId: processing.id } },
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
    selectChain.orderBy.mockResolvedValueOnce([processing]).mockResolvedValueOnce([])
    runsListMock.mockResolvedValueOnce({
      data: [createTriggerRun('COMPLETED', true)],
    })
    deleteReturningMock.mockResolvedValueOnce([
      { billingScopeId: processing.billingScopeId, parentPendingExecutionId: null },
    ])
    updateReturningMock.mockResolvedValueOnce([
      { ...pending, status: 'processing', processingStartedAt: new Date() },
    ])

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: pending.id,
    })

    expect(deleteReturningMock).toHaveBeenCalledOnce()
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(pending, 45),
      expect.anything()
    )
  })
})

describe('wakePendingExecution', () => {
  beforeEach(() => {
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({
      concurrencyLimit: 2,
      displayName: 'Pro',
      workflowExecutionTimeLimitSeconds: 45,
    })
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

    await wakePendingExecution(userBillingScope)

    expect(triggerMock).toHaveBeenCalledTimes(2)
    expect(triggerMock.mock.calls.map((call) => call[1])).toEqual([
      createSupervisorPayload(first, 45),
      createSupervisorPayload(second, 45),
    ])
    expect(updateReturningMock).toHaveBeenCalledTimes(2)
    expect(getTriggerExecutionStateMock).toHaveBeenCalledOnce()
  })

  it('continues the bounded wake after permanent document rejection before reporting the error', async () => {
    const rejected = createPendingRow({
      id: 'doc',
      executionType: 'document',
      source: 'document_processing',
    })
    const next = createPendingRow({ id: 'next' })
    const error = new ApiError(422, undefined, 'Invalid job', undefined)
    triggerMock.mockRejectedValueOnce(error)
    finalizePendingExecutionFailureMock.mockResolvedValueOnce('retired')
    mockClaimableRow(rejected)
    mockClaimableRow(next)
    await expect(wakePendingExecution(userBillingScope)).rejects.toBe(error)
    expect(triggerMock.mock.calls.map((call) => call[1].pendingExecutionId)).toEqual([
      'doc',
      'next',
    ])
    expect(finalizePendingExecutionFailureMock.mock.invocationCallOrder[0]).toBeLessThan(
      triggerMock.mock.invocationCallOrder[1]
    )
  })

  it('returns a pre-admission claim to the queue and propagates the wake failure', async () => {
    const row = createPendingRow()
    const error = new Error('Trigger wake failed')
    mockClaimableRow(row)
    idempotencyCreateMock.mockRejectedValueOnce(error)

    await expect(wakePendingExecution(userBillingScope)).rejects.toThrow(error.message)

    expect(updateChain.set).toHaveBeenCalledWith({
      status: 'pending',
      processingStartedAt: null,
      updatedAt: expect.any(Date),
    })
  })
})

describe('processing-row reconciliation', () => {
  it.each([false, true])('heartbeat-forced cancellation (dispatch fails: %s)', async (fails) => {
    const { createBackgroundExecutionTask } = await import('@/background/execution-job')
    const task = createBackgroundExecutionTask('workflow') as any
    const row = createPendingRow({
      status: 'processing',
      payload: { cancelRequestedAt: new Date().toISOString() },
    })
    const active = mockDrainingOwner(row)
    const next = createPendingRow({ id: 'successor' })
    updateChain.set.mockImplementationOnce(({ payload }) => ({
      where: async (scope: ReturnType<typeof andMock>) => {
        expect(scope.args).toEqual([
          { field: 'pendingExecution.id', value: row.id },
          { field: 'pendingExecution.status', value: 'processing' },
          { field: 'pendingExecution.executionType', value: 'workflow' },
          { field: 'pendingExecution.billingScopeId', value: row.billingScopeId },
          { field: 'pendingExecution.billingScopeType', value: row.billingScopeType },
        ])
        expect(payload.strings.join('')).toContain("'{drainedWorkflowRuns}'")
        const [, , runId, durationMs] = payload.values
        await Promise.resolve()
        row.payload.drainedWorkflowRuns = { [runId]: durationMs }
      },
    }))
    const dispatchError = new Error('Settlement dispatch failed')
    let receiptAtDispatch: unknown
    if (fails) {
      detachedTriggerMock.mockImplementationOnce(async () => {
        receiptAtDispatch = row.payload.drainedWorkflowRuns
        throw dispatchError
      })
    }
    // Trigger returns this closed root even when it finalized the cancellation on heartbeat expiry.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith('/result')) return Response.json(exitResult('TASK_RUN_CANCELLED'))
        if (url.pathname.endsWith('/trace'))
          return Response.json({ trace: { rootSpan: { id: 'root', runId: cancelledChild.id } } })
        expect(url.pathname).toBe(`/api/v1/runs/${cancelledChild.id}/events`)
        return Response.json({
          events: [
            { spanId: 'root', runId: cancelledChild.id, isPartial: false, isCancelled: true },
          ],
        })
      })
    )
    runsListMock.mockResolvedValue({ data: [startedSupervisor] })
    runsRetrieveMock.mockResolvedValue({
      relatedRuns: {
        children: [{ ...cancelledChild, startedAt: new Date(), finishedAt: new Date() }],
      },
    })
    let disconnect!: (error: Error) => void
    let release!: () => void
    const closed = new Promise<never>((_, reject) => {
      disconnect = reject
    })
    const effect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const transaction = transactionMock.getMockImplementation()!
    transactionMock.mockImplementationOnce((callback) =>
      Promise.race([transaction(callback), closed])
    )
    const reported = vi.fn()
    const runPromise = withPendingWorkflowExecution(row.id, effect)
    const cancellation = task.onCancel({
      payload: { pendingExecutionId: row.id, ...userBillingScope },
      ctx: { run: { id: cancelledChild.id }, attempt: { startedAt: new Date(Date.now() - 2000) } },
      runPromise,
    })
    const hook = fails ? expect(cancellation).rejects.toBe(dispatchError) : cancellation
    const run = runPromise.catch(reported)
    await vi.waitFor(() => expect(effect).toHaveBeenCalledOnce())
    const error = new Error('Lock connection closed')
    disconnect(error)
    txExecuteMock.mockResolvedValue([{ acquired: true }])
    const target = {
      pendingExecutionId: row.id,
      userId: row.userId,
      workflowId: row.workflowId!,
      workspaceId: row.workspaceId!,
    }
    const acknowledged = vi.fn()
    const stop = waitForPendingWorkflowExecutionDrain(
      target,
      { status: 'cancelling', pendingExecutionId: row.id },
      AbortSignal.timeout(4000)
    ).then(acknowledged)
    try {
      await vi.waitFor(() => expect(runsRetrieveMock).toHaveBeenCalled())
      expect(reported).not.toHaveBeenCalled()
      expect(updateChain.set).not.toHaveBeenCalled()
      expect(detachedTriggerMock).not.toHaveBeenCalled()
      expect(acknowledged).not.toHaveBeenCalled()
      expect(active).toEqual([row])
      resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({ concurrencyLimit: 1 })
      txSelectLimitMock.mockResolvedValueOnce([next]).mockResolvedValueOnce([next])
      txSelectRowsMock.mockImplementation(async () => active)
      selectChain.orderBy.mockResolvedValueOnce([...active])
      await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
        status: 'capacity_blocked',
        pendingExecutionId: next.id,
      })
      expect(triggerMock).not.toHaveBeenCalled()
    } finally {
      mockClaimableRow(next)
      release()
      await Promise.all([run, hook, stop])
    }
    expect(reported).toHaveBeenCalledExactlyOnceWith(error)
    if (fails) {
      const [first, retry] = detachedTriggerMock.mock.calls
      expect(receiptAtDispatch).toEqual({
        [cancelledChild.id]: first[1].cancelledWorkflowDurationMs,
      })
      expect(retry).toEqual(first)
    }
    expect(detachedTriggerMock).toHaveBeenCalledTimes(fails ? 2 : 1)
    expect(finalizePendingExecutionFailureMock).toHaveBeenCalledOnce()
    expect(acknowledged).toHaveBeenCalledOnce()
    expect(active).toHaveLength(0)
    expect(triggerMock).toHaveBeenCalledExactlyOnceWith(
      'pending-execution',
      createSupervisorPayload(next, TIMEOUT_NONE),
      expect.anything()
    )
  })

  const startedSupervisor = {
    ...createTriggerRun('CANCELED', true, { startedAt: new Date(), durationMs: 0 }),
    id: 'supervisor-for-stopped-job',
  }
  const cancelledChild = {
    ...createTriggerRun('CANCELED', true, { durationMs: 0 }),
    id: 'workload',
    taskIdentifier: 'workflow-execution',
    triggerFunction: 'triggerAndWait',
  }

  const exitedChild = { ...cancelledChild, status: 'SYSTEM_FAILURE', startedAt: new Date() }
  it('keeps an earlier possible submission fenced when a retry stops before dispatch', async () => {
    const row = createPendingRow({
      status: 'processing',
      payload: { firstWorkflowDispatchAttempt: 'supervisor:1' },
    })
    const owner = { pendingExecutionId: row.id, ...userBillingScope }
    updateReturningMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([])
    await expect(prepareWorkflowDispatch(owner, 'supervisor:2')).resolves.toEqual(row)
    const { payload } = updateChain.set.mock.calls[0][0]
    expect(payload.strings.join('?')).toContain(
      "jsonb_build_object('firstWorkflowDispatchAttempt', ?::text) || ?"
    )
    expect(payload.values).toEqual(['supervisor:2', 'pendingExecution.payload'])
    await requestCancelledWorkflowSettlement(row.id, owner, 0, 'supervisor', 'supervisor:2')
    const [scope, guard] = updateChain.where.mock.lastCall![0].args
    expect(scope).toEqual(updateChain.where.mock.calls[0][0])
    expect(guard.strings.join('?')).toMatch(
      /firstWorkflowDispatchAttempt' is null\s+or .*firstWorkflowDispatchAttempt' = \?/
    )
    expect(guard.values).toEqual([
      'pendingExecution.payload',
      'pendingExecution.payload',
      'supervisor:2',
    ])
    expect(detachedTriggerMock).not.toHaveBeenCalled()
  })
  it('retries settlement for an acknowledged supervisor with an empty child list', async () => {
    const row = createPendingRow({
      status: 'processing',
      payload: { cancelRequestedAt: new Date().toISOString() },
    })
    const active = mockDrainingOwner(row)
    const next = createPendingRow({ id: 'successor' })
    updateChain.set.mockImplementationOnce(({ payload }) => ({
      where: () => ({
        returning: async () => {
          const [, , id, duration] = payload.values
          row.payload.drainedWorkflowRuns = { [id]: duration }
          return [{ id: row.id }]
        },
      }),
    }))
    detachedTriggerMock.mockRejectedValueOnce(new Error('Settlement dispatch failed'))
    await expect(
      requestCancelledWorkflowSettlement(
        row.id,
        row,
        17,
        startedSupervisor.id,
        `${startedSupervisor.id}:1`
      )
    ).rejects.toThrow('Settlement dispatch failed')
    expect(active).toHaveLength(1)
    txExecuteMock.mockResolvedValue([{ acquired: true }])
    runsListMock.mockResolvedValue({ data: [startedSupervisor] })
    runsRetrieveMock.mockResolvedValue({ relatedRuns: { children: [] } })
    mockClaimableRow(next)
    await waitForPendingWorkflowExecutionDrain(
      {
        pendingExecutionId: row.id,
        userId: row.userId,
        workflowId: row.workflowId!,
        workspaceId: row.workspaceId!,
      },
      { status: 'cancelling', pendingExecutionId: row.id },
      AbortSignal.timeout(4000)
    )
    expect(detachedTriggerMock).toHaveBeenCalledTimes(2)
    expect(detachedTriggerMock.mock.calls[1]).toEqual(detachedTriggerMock.mock.calls[0])
    expect(detachedTriggerMock).toHaveBeenLastCalledWith(
      'pending-execution',
      {
        pendingExecutionId: row.id,
        ...userBillingScope,
        cancelledWorkflowDurationMs: 17,
      },
      expect.anything()
    )
    expect(finalizePendingExecutionFailureMock).toHaveBeenCalledExactlyOnceWith(
      row,
      'Workflow execution was cancelled',
      17
    )
    expect(active).toHaveLength(0)
    expect(triggerMock).toHaveBeenCalledExactlyOnceWith(
      'pending-execution',
      createSupervisorPayload(next, TIMEOUT_NONE),
      expect.anything()
    )
  })
  const workloadIdentity = { id: exitedChild.id, taskIdentifier: exitedChild.taskIdentifier }
  const returnedWorkload = {
    ...workloadIdentity,
    status: 'COMPLETED',
    output: { success: true, pendingExecutionId: 'pending-1' },
  }
  const exitResult = (code = 'TASK_PROCESS_SIGTERM') => ({
    ...workloadIdentity,
    ok: false,
    error: { type: 'INTERNAL_ERROR', code },
  })

  function mockWorkloadResult(result: object | null = exitResult()) {
    const read = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe(`/api/v1/runs/${exitedChild.id}/result`)
      return result ? Response.json(result) : new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', read)
    return read
  }

  function deliverSettlement() {
    detachedTriggerMock.mockImplementation(async (_task, payload) =>
      finalizeCancelledPendingWorkflow(
        payload.pendingExecutionId,
        payload.cancelledWorkflowDurationMs
      )
    )
  }

  function mockDrainingOwner(row: PendingExecutionClaim) {
    const active = [row]
    detachedTriggerMock.mockImplementation(async (_task, payload) => {
      const { executePendingExecution } = await vi.importActual<
        typeof import('@/background/pending-execution-worker')
      >('@/background/pending-execution-worker')
      return executePendingExecution(payload)
    })
    selectLimitMock.mockImplementation(async () => active)
    selectChain.where.mockImplementation((filter) =>
      filter.args?.[1]?.args?.[0]?.field === 'pendingExecution.id'
        ? Promise.resolve(
            active.map(({ id, billingScopeType }) => ({ id, billingScopeType, cancelling: true }))
          )
        : selectChain
    )
    updateReturningMock.mockResolvedValueOnce([row])
    finalizePendingExecutionFailureMock.mockImplementationOnce((owner) =>
      settlePendingExecutionOwner(owner, { wake: false })
    )
    deleteReturningMock.mockImplementationOnce(async () => active.splice(0))
    readWorkflowCheckpointChildrenMock.mockResolvedValue([])
    return active
  }

  beforeEach(() => {
    detachedTriggerMock.mockReset().mockResolvedValue({ id: 'settlement' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    selectChain.where.mockReturnThis()
  })

  it.each([
    ['worker returned', 'COMPLETED', returnedWorkload, true],
    [
      'completed without a worker acknowledgement',
      'COMPLETED',
      { ...returnedWorkload, output: undefined },
      false,
    ],
    [
      'worker returned for another owner',
      'COMPLETED',
      { ...returnedWorkload, output: { success: true, pendingExecutionId: 'another-owner' } },
      false,
    ],
    [
      'process exited after its grace period',
      'SYSTEM_FAILURE',
      exitResult('GRACEFUL_EXIT_TIMEOUT'),
      true,
    ],
    [
      'process exited with status 137',
      'CRASHED',
      exitResult('TASK_PROCESS_MAYBE_OOM_KILLED'),
      true,
    ],
    ['heartbeat classified as OOM', 'CRASHED', exitResult('TASK_PROCESS_OOM_KILLED'), false],
    [
      'disconnected process channel',
      'CRASHED',
      exitResult('TASK_PROCESS_EXITED_WITH_NON_ZERO_CODE'),
      false,
    ],
    ['missing result', 'SYSTEM_FAILURE', null, false],
    ['different workload', 'SYSTEM_FAILURE', { ...exitResult(), id: 'another-run' }, false],
    [
      'different task',
      'SYSTEM_FAILURE',
      { ...exitResult(), taskIdentifier: 'another-task' },
      false,
    ],
  ] as const)(
    'checks the started workload receipt for %s',
    async (_case, status, result, settled) => {
      const row = createPendingRow({
        status: 'processing',
        payload: { cancelRequestedAt: new Date().toISOString() },
      })
      selectChain.orderBy.mockResolvedValueOnce([row])
      runsListMock.mockResolvedValueOnce({ data: [startedSupervisor] })
      runsRetrieveMock.mockResolvedValueOnce({
        relatedRuns: {
          children: [{ ...exitedChild, status }],
        },
      })
      const read = mockWorkloadResult(result)
      if (status === 'COMPLETED') runsRetrieveMock.mockResolvedValueOnce(result)
      await dispatchNextPendingExecution(userBillingScope)
      if (status === 'COMPLETED') expect(runsRetrieveMock).toHaveBeenLastCalledWith(exitedChild.id)
      else expect(read).toHaveBeenCalledOnce()
      expect(detachedTriggerMock).toHaveBeenCalledTimes(settled ? 1 : 0)
      expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
      expect(deleteWhereMock).not.toHaveBeenCalled()
    }
  )

  it('retries the scope wake after marker retirement and dispatches the queued successor without another admission', async () => {
    const { createBackgroundExecutionTask } = await import('@/background/execution-job')
    const { executePendingExecution } = await vi.importActual<
      typeof import('@/background/pending-execution-worker')
    >('@/background/pending-execution-worker')
    const task = createBackgroundExecutionTask('workflow') as any
    const payload = { pendingExecutionId: 'retired', ...userBillingScope }
    txExecuteMock.mockResolvedValue([{ acquired: true }])
    await task.onCancel({
      payload,
      ctx: { run: { id: cancelledChild.id }, attempt: { startedAt: new Date() } },
      runPromise: Promise.reject(new Error('first wake failed after retirement')),
    })
    expect(detachedTriggerMock).toHaveBeenCalledOnce()
    const [taskId, settlement, options] = detachedTriggerMock.mock.calls[0]
    expect(taskId).toBe('pending-execution')
    expect(settlement).toEqual({ ...payload, cancelledWorkflowDurationMs: expect.any(Number) })
    expect(options).toEqual({
      idempotencyKey: expect.stringMatching(/^pending-execution:[a-f0-9]{64}:cancel$/),
    })
    updateReturningMock.mockResolvedValueOnce([])
    const next = createPendingRow({ id: 'next' })
    mockClaimableRow(next)
    getTriggerExecutionStateMock.mockRejectedValueOnce(new Error('scope wake failed'))
    await executePendingExecution(settlement)
    expect(wakeDelayMock).toHaveBeenCalledOnce()
    expect(triggerMock).toHaveBeenCalledExactlyOnceWith(
      'pending-execution',
      createSupervisorPayload(next, TIMEOUT_NONE),
      expect.anything()
    )
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
  })

  const stages = [
    'before supervisor startup',
    'before child startup',
    'after forced child termination',
  ]
  it.each(stages)('releases a stopped slot %s', async (stage) => {
    const stopped = createPendingRow({
      id: 'stopped',
      status: 'processing',
      processingStartedAt: new Date(),
      payload:
        stage === 'after forced child termination'
          ? {}
          : { cancelRequestedAt: new Date().toISOString() },
    })
    const active = [stopped]
    deliverSettlement()
    txExecuteMock.mockResolvedValue([{ acquired: true }])
    const next = createPendingRow()
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue({ concurrencyLimit: 1 })
    txSelectLimitMock.mockResolvedValue([next])
    txSelectRowsMock.mockImplementation(async () => active)
    selectChain.orderBy.mockResolvedValueOnce(active)
    runsListMock.mockResolvedValue({
      data: [
        stage === 'before supervisor startup'
          ? createTriggerRun('CANCELED', true, { durationMs: 0 })
          : startedSupervisor,
      ],
    })
    finalizePendingExecutionFailureMock.mockImplementationOnce((row) =>
      settlePendingExecutionOwner(row, { wake: false })
    )
    deleteReturningMock.mockImplementationOnce(async () => active.splice(0))

    if (stage !== 'before supervisor startup') {
      const forced = stage === 'after forced child termination'
      const child = forced ? exitedChild : cancelledChild
      let workerAlive = true
      if (forced) {
        selectLimitMock.mockImplementation(async () => active)
        mockWorkloadResult()
        txExecuteMock.mockImplementation(async (query) => {
          if (query.strings.join('').includes('pg_try_advisory_xact_lock')) {
            expect(
              query.values.flatMap((value: { values?: unknown[] }) => value?.values ?? value)
            ).toContain(stopped.id)
            return [{ acquired: !workerAlive }]
          }
        })
      }
      runsRetrieveMock.mockResolvedValueOnce({
        relatedRuns: {
          children: [{ ...child, status: forced ? 'EXECUTING' : 'QUEUED', isCompleted: false }],
        },
      })
      await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
        status: 'capacity_blocked',
        pendingExecutionId: next.id,
      })
      expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
      expect(deleteWhereMock).not.toHaveBeenCalled()
      if (forced) {
        stopped.payload.cancelRequestedAt = new Date().toISOString()
      }
      workerAlive = false
      selectChain.orderBy.mockResolvedValueOnce(active)
      runsRetrieveMock.mockResolvedValueOnce({ relatedRuns: { children: [child] } })
    }
    updateReturningMock.mockResolvedValueOnce([stopped])
    mockClaimableRow(next)
    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'dispatched',
      pendingExecutionId: next.id,
    })
    expect(finalizePendingExecutionFailureMock).toHaveBeenCalledExactlyOnceWith(
      stopped,
      'Workflow execution was cancelled',
      0
    )
    expect(deleteWhereMock).toHaveBeenCalledExactlyOnceWith({
      field: 'pendingExecution.id',
      value: stopped.id,
    })
    expect(triggerMock).toHaveBeenCalledExactlyOnceWith(
      'pending-execution',
      createSupervisorPayload(next, TIMEOUT_NONE),
      expect.anything()
    )
    expect(runsRetrieveMock.mock.calls).toEqual(
      stage === 'before supervisor startup' ? [] : [[startedSupervisor.id], [startedSupervisor.id]]
    )
    selectChain.where.mockResolvedValueOnce(active)
    readWorkflowCheckpointChildrenMock.mockResolvedValueOnce([])
    await waitForPendingWorkflowExecutionDrain(
      {
        pendingExecutionId: stopped.id,
        userId: stopped.userId,
        workspaceId: stopped.workspaceId!,
        workflowId: stopped.workflowId!,
      },
      { status: 'cancelling', pendingExecutionId: stopped.id },
      AbortSignal.timeout(2000)
    )
  })

  it('recovers a terminated workflow from an outstanding Stop without another admission', async () => {
    const row = createPendingRow({
      status: 'processing',
      payload: { cancelRequestedAt: new Date().toISOString() },
    })
    const active = mockDrainingOwner(row)
    let release!: () => void
    let terminate!: (error: Error) => void
    const held = new Promise<void>((resolve, reject) => {
      release = resolve
      terminate = reject
    })
    let workerKey: unknown
    let workerExited = false
    const receipt = mockWorkloadResult()
    const tryLock = vi.fn((key) => {
      expect(key).toEqual(workerKey)
      return [{ acquired: workerExited }]
    })
    txExecuteMock.mockImplementation(async ({ strings, values }) => {
      const statement = strings.join('')
      if (statement.includes('pg_advisory_xact_lock_shared')) workerKey = values[0]
      if (statement.includes('pg_try_advisory_xact_lock')) return tryLock(values[0])
    })
    const workload = withPendingWorkflowExecution(row.id, () => held).finally(() => {
      workerExited = true
    })
    await vi.waitFor(() =>
      expect(workerKey).toMatchObject({ values: [expect.any(Number), row.id] })
    )
    runsListMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValue({ data: [startedSupervisor] })
    runsRetrieveMock.mockImplementation(async () => ({
      relatedRuns: {
        children: [
          workerExited ? exitedChild : { ...exitedChild, status: 'EXECUTING', isCompleted: false },
        ],
      },
    }))
    const acknowledged = vi.fn()
    try {
      const stop = waitForPendingWorkflowExecutionDrain(
        {
          pendingExecutionId: row.id,
          userId: row.userId,
          workspaceId: row.workspaceId!,
          workflowId: row.workflowId!,
        },
        { status: 'cancelling', pendingExecutionId: row.id },
        AbortSignal.timeout(5000)
      ).then(acknowledged)
      await vi.waitFor(() => expect(runsRetrieveMock).toHaveBeenCalled(), { timeout: 2000 })
      expect(receipt).not.toHaveBeenCalled()
      expect(tryLock).not.toHaveBeenCalled()
      expect(acknowledged).not.toHaveBeenCalled()
      expect(updateChain.set).not.toHaveBeenCalled()
      expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
      expect(triggerMock).not.toHaveBeenCalled()
      terminate(new Error('worker terminated'))
      await expect(workload).rejects.toThrow('worker terminated')
      await stop
      expect(receipt).toHaveBeenCalledOnce()
      expect(tryLock).toHaveBeenCalledOnce()
      expect(acknowledged).toHaveBeenCalledOnce()
      expect(updateChain.where).toHaveBeenCalledWith({
        args: [
          { field: 'pendingExecution.id', value: row.id },
          { field: 'pendingExecution.status', value: 'processing' },
          { field: 'pendingExecution.executionType', value: 'workflow' },
          { field: 'pendingExecution.billingScopeType', value: 'local', operator: 'ne' },
        ],
      })
      expect(finalizePendingExecutionFailureMock).toHaveBeenCalledExactlyOnceWith(
        row,
        'Workflow execution was cancelled',
        0
      )
      expect(active).toHaveLength(0)
      expect(triggerMock).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it('releases a completed parent when its stopped workflow-block child was forcibly terminated', async () => {
    mockWorkloadResult()
    deliverSettlement()
    const cancelled = { cancelRequestedAt: new Date().toISOString() }
    const parent = createPendingRow({
      status: 'processing',
      payload: { ...cancelled, ownerCompletedAt: new Date().toISOString() },
    })
    const child = createPendingRow({
      id: 'child',
      source: 'workflow_block',
      status: 'processing',
      payload: { ...cancelled, metadata: { parentPendingExecutionId: parent.id } },
    })
    selectLimitMock
      .mockResolvedValueOnce([parent])
      .mockResolvedValueOnce([child])
      .mockResolvedValueOnce([parent])
    selectChain.orderBy.mockResolvedValueOnce([child])
    runsListMock
      .mockResolvedValueOnce({ data: [createTriggerRun('COMPLETED', true)] })
      .mockResolvedValueOnce({ data: [startedSupervisor] })
    runsRetrieveMock.mockResolvedValueOnce({
      relatedRuns: { children: [exitedChild] },
    })
    txExecuteMock.mockResolvedValueOnce([{ acquired: true }])
    updateReturningMock.mockResolvedValueOnce([child])
    deleteReturningMock
      .mockResolvedValueOnce([{ parentPendingExecutionId: parent.id }])
      .mockResolvedValueOnce([])
    finalizePendingExecutionFailureMock.mockImplementationOnce((owner) =>
      settlePendingExecutionOwner(owner, { wake: false })
    )
    await reconcileStoppedWorkflowOwner(parent.id, AbortSignal.timeout(2000))
    expect(finalizePendingExecutionFailureMock).toHaveBeenCalledExactlyOnceWith(
      child,
      'Workflow execution was cancelled',
      0
    )
    expect(deleteWhereMock.mock.calls.map(([id]) => id.value)).toEqual([child.id, parent.id])
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('keeps Stop retryable when Trigger discovery outlasts its deadline', async () => {
    const row = createPendingRow({
      status: 'processing',
      payload: { cancelRequestedAt: new Date().toISOString() },
    })
    selectChain.where.mockResolvedValueOnce([
      { id: row.id, billingScopeType: row.billingScopeType, cancelling: true },
    ])
    selectLimitMock.mockResolvedValueOnce([row])
    let finishDiscovery!: (page: { data: (typeof startedSupervisor)[] }) => void
    runsListMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDiscovery = resolve
      })
    )
    const controller = new AbortController()
    const stop = waitForPendingWorkflowExecutionDrain(
      {
        pendingExecutionId: row.id,
        userId: row.userId,
        workflowId: row.workflowId!,
        workspaceId: row.workspaceId!,
      },
      { status: 'cancelling', pendingExecutionId: row.id },
      controller.signal
    )
    await vi.waitFor(() => expect(runsListMock).toHaveBeenCalledOnce())
    controller.abort(new Error('Stop deadline'))
    await expect(stop).rejects.toThrow('Stop deadline')
    finishDiscovery({ data: [startedSupervisor] })
    await Promise.resolve()
    expect(runsRetrieveMock).not.toHaveBeenCalled()
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
    expect(updateChain.set).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it.each([
    { state: 'executing', run: createTriggerRun('EXECUTING', false) },
    {
      state: 'awaiting worker acknowledgement',
      run: startedSupervisor,
      children: [
        { ...cancelledChild, startedAt: new Date() },
        { ...cancelledChild, id: 'started-workload', startedAt: new Date() },
      ],
    },
    { state: 'awaiting child discovery', run: startedSupervisor, children: [] },
    {
      state: 'only unrelated child runs are visible',
      run: startedSupervisor,
      children: [
        { ...cancelledChild, taskIdentifier: 'another-task' },
        { ...cancelledChild, triggerFunction: 'trigger' },
      ],
    },
    { state: 'awaiting admission', run: undefined },
  ])('retains a cancelling owner while $state', async ({ run, children }) => {
    const cancelled = createPendingRow({
      id: 'cancelled-1',
      status: 'processing',
      processingStartedAt: new Date(),
      payload: {
        cancelRequestedAt: '2026-08-23T12:00:00.000Z',
        drainedWorkflowRuns: { [cancelledChild.id]: 800 },
      },
    })
    selectChain.orderBy.mockResolvedValueOnce([cancelled])
    runsListMock.mockResolvedValueOnce({ data: run ? [run] : [] })
    if (children) runsRetrieveMock.mockResolvedValueOnce({ relatedRuns: { children } })

    await expect(dispatchNextPendingExecution(userBillingScope)).resolves.toEqual({
      status: 'empty',
    })

    expect(runsListMock).toHaveBeenCalledWith({
      tag: expect.stringMatching(/^pending-execution:[a-f0-9]{64}$/),
      taskIdentifier: 'pending-execution',
      limit: 1,
    })
    expect(runsCancelMock).not.toHaveBeenCalled()
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
    expect(deleteReturningMock).not.toHaveBeenCalled()
    if (run) expect(triggerMock).not.toHaveBeenCalled()
    else
      expect(triggerMock).toHaveBeenCalledExactlyOnceWith(
        'pending-execution',
        createSupervisorPayload(cancelled, TIMEOUT_NONE),
        { idempotencyKey: 'idempotency-key', tags: [idempotencyCreateMock.mock.calls[0][0]] }
      )

    const completed = {
      ...cancelled,
      payload: { ...cancelled.payload, ownerCompletedAt: new Date().toISOString() },
    }
    selectChain.orderBy.mockResolvedValueOnce([completed])
    if (run?.status === 'CANCELED') {
      deliverSettlement()
      txExecuteMock.mockResolvedValue([{ acquired: true }])
      updateReturningMock.mockResolvedValueOnce([completed])
    }
    runsListMock.mockResolvedValueOnce({ data: run ? [run] : [] })
    await dispatchNextPendingExecution(userBillingScope)
    expect(deleteWhereMock).toHaveBeenCalledExactlyOnceWith({
      field: 'pendingExecution.id',
      value: cancelled.id,
    })
    expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
  })
})

describe('enqueuePendingExecution', () => {
  const workflowAdmission = {
    executionType: 'workflow' as const,
    pendingExecutionId: 'pending-local-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    source: 'workflow_api',
    payload: { executionId: 'pending-local-1' },
    afterInsert: vi.fn(),
  }
  const checkpointAdmission = {
    executionType: 'workflow' as const,
    pendingExecutionId: 'execution:resume:1',
    userId: 'original-user',
    source: 'human_in_the_loop',
    payload: {},
  }

  beforeEach(() => {
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)
    txInsertValuesMock.mockReturnValue(txInsertChain)
    txInsertReturningMock.mockResolvedValue([{ id: 'inserted' }])
  })

  it('commits a checkpoint-only admission without inserting or dispatching work', async () => {
    const beforeEnqueue = vi.fn(async () => false)
    const result = await enqueuePendingExecution({
      ...checkpointAdmission,
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      beforeEnqueue,
    })
    expect(result.inserted).toBe(false)
    expect(beforeEnqueue).toHaveBeenCalledOnce()
    expect(beforeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ execute: txExecuteMock }))
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'reserves backlog admission only for a trusted checkpoint continuation: %s',
    async (continuation) => {
      getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
      resolveServerExecutionBillingContextMock.mockResolvedValueOnce({
        scopeId: 'scope-1',
        scopeType: 'user',
        tier: { maxPendingAgeSeconds: null, maxPendingCount: 0 },
      })
      if (!continuation) {
        txSelectChain.where
          .mockReturnValueOnce(txSelectChain)
          .mockReturnValueOnce(txSelectChain)
          .mockResolvedValueOnce([{ count: 0 }])
      }
      const beforeEnqueue = vi.fn(async () => true)
      const admission = enqueuePendingExecution({
        ...checkpointAdmission,
        workflowId: 'workflow-1',
        userId: 'user-1',
        payload: { continuation: true },
        ...(continuation ? { continuation: true } : {}),
        beforeEnqueue,
      })
      if (continuation) {
        await expect(admission).resolves.toMatchObject({ inserted: true })
        expect(txInsertValuesMock).toHaveBeenCalled()
      } else {
        await expect(admission).rejects.toThrow('Pending execution backlog is full')
        expect(txInsertValuesMock).not.toHaveBeenCalled()
      }
      expect(beforeEnqueue).toHaveBeenCalledOnce()
      expect(transactionMock.mock.settledResults[0]).toMatchObject({
        type: continuation ? 'fulfilled' : 'rejected',
      })
      expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
    }
  )

  it('prunes aged new requests without orphaning admitted workflow continuations', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingContextMock.mockResolvedValueOnce({
      scopeId: 'scope-1',
      scopeType: 'user',
      tier: { maxPendingAgeSeconds: 60, maxPendingCount: null },
    })
    await enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'new-request',
      workflowId: 'workflow-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: {},
    })
    expect(deleteWhereMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          { field: 'pendingExecution.billingScopeId', value: 'scope-1' },
          { field: 'pendingExecution.status', value: 'pending' },
          { field: 'pendingExecution.source', value: 'human_in_the_loop', operator: 'ne' },
        ]),
      })
    )
    const { lte } = await import('drizzle-orm')
    expect(lte).toHaveBeenCalledWith('pendingExecution.createdAt', expect.any(Date))
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'workflow_api' })
    )
  })

  it('does not enqueue when checkpoint validation fails inside admission', async () => {
    const beforeEnqueue = vi.fn(async () => {
      throw new Error('Stale checkpoint')
    })
    await expect(
      enqueuePendingExecution({
        ...checkpointAdmission,
        beforeEnqueue,
      })
    ).rejects.toThrow('Stale checkpoint')
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
  })

  it('runs checkpoint admission before duplicate checks without relaunching existing local work', async () => {
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'existing-log' }])
    const beforeEnqueue = vi.fn(async () => {
      expect(txSelectLimitMock).not.toHaveBeenCalled()
      return true
    })
    const result = await enqueuePendingExecution({
      ...checkpointAdmission,
      beforeEnqueue,
    })
    expect(result.inserted).toBe(false)
    expect(beforeEnqueue).toHaveBeenCalledOnce()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
  })

  it.each([directExecutionState, triggerEnabledState])(
    'rolls back the $mode admission when its receipt fails after insertion',
    async (triggerState) => {
      getTriggerExecutionStateMock.mockResolvedValue(triggerState)
      const afterInsert = vi.fn(async () => {
        expect(txInsertValuesMock).toHaveBeenCalledOnce()
        throw new Error('Receipt rejected')
      })
      await expect(
        enqueuePendingExecution({
          executionType: 'workflow',
          pendingExecutionId: 'native-execution',
          userId: 'user-1',
          source: 'workflow_queue',
          payload: {},
          afterInsert,
        })
      ).rejects.toThrow('Receipt rejected')
      expect(afterInsert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ execute: txExecuteMock })
      )
      expect(transactionMock.mock.settledResults[0]?.type).toBe('rejected')
      expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
      expect(triggerMock).not.toHaveBeenCalled()
    }
  )

  it('starts one streamed local execution from a direct ownership marker', async () => {
    const result = await enqueuePendingExecution({
      ...workflowAdmission,
      payload: { ...workflowAdmission.payload, stream: true },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-local-1',
      inserted: true,
    })
    expect(triggerMock).not.toHaveBeenCalled()
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(dispatchBackgroundExecutionMock).toHaveBeenCalledWith(
        { pendingExecutionId: 'pending-local-1', executionType: 'workflow' },
        'local',
        undefined
      )
    )
    expect(transactionMock).toHaveBeenCalledOnce()
    expect(workflowAdmission.afterInsert).toHaveBeenCalledOnce()
    expect(txExecuteMock).toHaveBeenCalledOnce()
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pending-local-1',
        billingScopeId: 'workspace-1',
        billingScopeType: 'local',
        status: 'processing',
        processingStartedAt: expect.any(Date),
      })
    )
    expect(resolveServerExecutionBillingContextMock).not.toHaveBeenCalled()
    expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
  })

  it.each([
    ['running', []],
    ['completed', [{ id: 'log-1' }]],
  ])('does not relaunch a %s local workflow', async (_state, existingLogs) => {
    txSelectLimitMock.mockResolvedValueOnce(existingLogs)
    if (!existingLogs.length) txInsertReturningMock.mockResolvedValueOnce([])

    const result = await enqueuePendingExecution(workflowAdmission)

    expect(result).toEqual({ pendingExecutionId: 'pending-local-1', inserted: false })
    expect(workflowAdmission.afterInsert).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
    expect(txInsertValuesMock).toHaveBeenCalledTimes(existingLogs.length ? 0 : 1)
    expect(resolveServerExecutionBillingContextMock).not.toHaveBeenCalled()
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

    await vi.waitFor(() =>
      expect(dispatchBackgroundExecutionMock).toHaveBeenCalledWith(
        { pendingExecutionId: 'document-local-1', executionType: 'document' },
        'local',
        'local-nonce'
      )
    )
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('reports a permanent document admission rejection after waking its successor', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    const rejected = createPendingRow({
      id: 'doc',
      executionType: 'document',
      source: 'document_processing',
    })
    const next = createPendingRow({ id: 'next' })
    const error = new ApiError(422, undefined, 'Invalid job', undefined)
    triggerMock.mockRejectedValueOnce(error)
    finalizePendingExecutionFailureMock.mockResolvedValueOnce('retired')
    txSelectLimitMock.mockResolvedValueOnce([])
    mockClaimableRow(rejected)
    mockClaimableRow(next)
    await expect(
      enqueuePendingExecution({
        pendingExecutionId: 'doc',
        executionType: 'document',
        source: 'document_processing',
        userId: 'user-1',
        payload: {},
      })
    ).rejects.toBe(error)
    expect(triggerMock.mock.calls.map((call) => call[1].pendingExecutionId)).toEqual([
      'doc',
      'next',
    ])
  })

  it('stores the resolved billing scope when billing is enabled', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    resolveServerExecutionBillingContextMock.mockResolvedValueOnce({
      scopeId: 'organization-1',
      scopeType: 'organization',
      tier: {
        maxPendingAgeSeconds: null,
        maxPendingCount: null,
      },
    })
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await enqueuePendingExecution({
      ...workflowAdmission,
      pendingExecutionId: 'pending-org-1',
      payload: { executionId: 'pending-org-1' },
    })

    expect(result).toEqual({
      pendingExecutionId: 'pending-org-1',
      inserted: true,
    })
    expect(workflowAdmission.afterInsert).toHaveBeenCalledOnce()
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pending-org-1',
        billingScopeId: 'organization-1',
        billingScopeType: 'organization',
      })
    )
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
  })

  it('wakes a duplicate pending execution through the normal scope drain', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    const processing = createPendingRow({ id: 'pending-local-1', status: 'processing' })
    txSelectLimitMock.mockResolvedValueOnce([{ id: 'pending-local-1' }])
    selectLimitMock.mockResolvedValueOnce([processing])
    selectChain.orderBy.mockResolvedValueOnce([processing])

    const result = await enqueuePendingExecution({ ...workflowAdmission, userId: 'scope-1' })

    expect(result).toEqual({
      pendingExecutionId: 'pending-local-1',
      inserted: false,
    })
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(processing, TIMEOUT_NONE),
      expect.anything()
    )
    expect(workflowAdmission.afterInsert).not.toHaveBeenCalled()
  })

  it('returns duplicate workflow execution ids that already have a durable log', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'log-1' }])

    const result = await enqueuePendingExecution({
      ...workflowAdmission,
      pendingExecutionId: 'execution-1',
      payload: { executionId: 'execution-1' },
    })

    expect(result).toEqual({
      pendingExecutionId: 'execution-1',
      inserted: false,
    })
    expect(txInsertValuesMock).not.toHaveBeenCalled()
    expect(workflowAdmission.afterInsert).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('dispatches the exact active ordering row when the same ordering key is enqueued', async () => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'pending-existing' }])
    const existing = createPendingRow({
      id: 'pending-existing',
      executionType: 'schedule',
      source: 'schedule',
      billingScopeId: 'user-1',
    })
    mockClaimableRow(existing)

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
    const triggerKey = idempotencyCreateMock.mock.calls[0]?.[0]
    expect(triggerMock).toHaveBeenCalledWith(
      'pending-execution',
      createSupervisorPayload(existing, TIMEOUT_NONE),
      {
        idempotencyKey: 'idempotency-key',
        tags: [triggerKey],
      }
    )
  })

  it.each([
    ['bad request', new ApiError(400, undefined, 'Bad request', undefined), 'permanent'],
    ['unauthorized', new ApiError(401, undefined, 'Unauthorized', undefined), 'permanent'],
    ['forbidden', new ApiError(403, undefined, 'Forbidden', undefined), 'permanent'],
    ['not found', new ApiError(404, undefined, 'Not found', undefined), 'permanent'],
    ['unprocessable', new ApiError(422, undefined, 'Unprocessable', undefined), 'permanent'],
    ['ambiguous', new Error('Trigger unavailable'), 'ambiguous'],
    ['timed out', new ApiError(408, undefined, 'Request timed out', undefined), 'retryable'],
    ['conflicted', new ApiError(409, undefined, 'Request conflicted', undefined), 'retryable'],
    ['rate-limited', new ApiError(429, undefined, 'Too many requests', undefined), 'reset'],
    ['server-failed', new ApiError(500, undefined, 'Server failed', undefined), 'retryable'],
  ])('applies the %s admission failure policy', async (_, error, policy) => {
    getTriggerExecutionStateMock.mockResolvedValue(triggerEnabledState)
    triggerMock.mockRejectedValue(error)
    if (error instanceof ApiError && error.status === 400)
      finalizePendingExecutionFailureMock.mockRejectedValueOnce(
        new Error('Failure finalization failed')
      )
    txSelectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const claimed = createPendingRow({ id: 'pending-a', billingScopeId: 'user-1' })
    mockClaimableRow(claimed)
    if (policy === 'ambiguous' || policy === 'retryable') {
      selectLimitMock.mockResolvedValueOnce([{ ...claimed, status: 'processing' }])
    }

    const beforeEnqueue = vi.fn(async () => true)
    const admission = enqueuePendingExecution({
      executionType: 'workflow',
      pendingExecutionId: 'pending-b',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      source: 'workflow_api',
      payload: { executionId: 'pending-b' },
      beforeEnqueue,
    })

    if (policy === 'permanent') {
      await expect(admission).rejects.toBe(error)
      expect(finalizePendingExecutionFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: claimed.id, status: 'processing' }),
        error.message,
        expect.any(Number)
      )
    } else {
      await expect(admission).rejects.toMatchObject(
        error instanceof ApiError
          ? {
              name: 'TriggerExecutionUnavailableError',
              message: 'Trigger.dev rejected execution admission. Retry the request.',
            }
          : { message: error.message }
      )
      expect(finalizePendingExecutionFailureMock).not.toHaveBeenCalled()
    }

    expect(beforeEnqueue).toHaveBeenCalledOnce()
    // Dispatch errors follow a committed admission; its receipt must remain committed too.
    expect(transactionMock.mock.settledResults[0]).toMatchObject({ type: 'fulfilled' })
    expect(txInsertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-b' }))
    expect(triggerMock).toHaveBeenCalledTimes(policy === 'permanent' || policy === 'reset' ? 1 : 2)
    if (policy === 'reset') {
      expect(updateChain.set).toHaveBeenCalledWith({
        status: 'pending',
        processingStartedAt: null,
        updatedAt: expect.any(Date),
      })
    } else {
      expect(updateChain.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      )
    }
  })
})

describe('claimNextPendingExecution', () => {
  const pendingRow = createPendingRow()

  it.each(['workflow', 'document'] as const)(
    'claims %s jobs when the billing scope has capacity',
    async (executionType) => {
      const row = createPendingRow({ executionType, source: executionType, payload: {} })
      resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce({
        concurrencyLimit: 2,
        displayName: 'Pro',
      })
      mockClaimableRow(row)
      txSelectRowsMock.mockResolvedValueOnce([
        { id: 'processing-1', source: 'workflow_api', payload: {} },
      ])
      await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
        status: 'claimed',
        row: expect.objectContaining({
          id: 'pending-1',
          executionType,
          status: 'processing',
        }),
      })
    }
  )

  it('claims pending rows without a capacity check when local billing tier resolution is unavailable', async () => {
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce(null)
    mockClaimableRow(pendingRow)

    await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
      status: 'claimed',
      row: expect.objectContaining({
        id: 'pending-1',
        status: 'processing',
      }),
    })

    expect(resolveServerExecutionBillingTierForScopeMock).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      scopeType: 'user',
    })
    expect(txSelectLimitMock).toHaveBeenCalledTimes(1)
  })

  it.each(['workflow', 'document'] as const)(
    'leaves %s jobs queued when the billing scope is full',
    async (executionType) => {
      resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce({
        concurrencyLimit: 1,
        displayName: 'Starter',
      })
      txSelectLimitMock.mockResolvedValueOnce([
        createPendingRow({ executionType, source: executionType, payload: {} }),
      ])
      txSelectRowsMock.mockResolvedValueOnce([
        { id: 'processing-1', source: 'workflow_api', payload: {} },
      ])

      await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
        status: 'capacity_blocked',
        pendingExecutionId: 'pending-1',
      })
      expect(updateReturningMock).not.toHaveBeenCalled()
    }
  )

  it.each(['parent-1', 'parent-1:resume:2'])(
    'prioritizes and claims a child under capacity marker %s at concurrency one',
    async (parentPendingExecutionId) => {
      resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce({
        concurrencyLimit: 1,
        displayName: 'Starter',
      })
      const orphanChild = {
        ...pendingRow,
        id: 'orphan-child',
        source: 'workflow_block',
        payload: { metadata: { parentPendingExecutionId: 'missing-parent' } },
        createdAt: new Date(0),
      }
      const childRow = {
        ...pendingRow,
        id: 'runnable-child',
        source: 'workflow_block',
        payload: { metadata: { parentExecutionId: 'parent-1', parentPendingExecutionId } },
        createdAt: new Date(1),
      }
      let activeParentWasPrioritized = false
      txSelectChain.orderBy.mockImplementationOnce((priority: { strings?: string[] }) => {
        activeParentWasPrioritized =
          priority.strings?.join('').includes("->>'parentPendingExecutionId'") ?? false
        return txSelectChain
      })
      txSelectLimitMock.mockImplementationOnce(async () => [
        activeParentWasPrioritized ? childRow : orphanChild,
      ])
      txSelectRowsMock.mockResolvedValueOnce([
        { id: parentPendingExecutionId, source: 'workflow_api', payload: {} },
      ])
      updateReturningMock.mockResolvedValueOnce([
        {
          ...childRow,
          status: 'processing',
          processingStartedAt: new Date(),
        },
      ])

      await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
        status: 'claimed',
        row: expect.objectContaining({
          id: 'runnable-child',
          source: 'workflow_block',
          status: 'processing',
        }),
      })
      expect(resolveServerExecutionBillingTierForScopeMock).toHaveBeenCalledOnce()
      expect(
        sqlMock.mock.calls.some(([strings]) =>
          strings.join('').includes('parent_pending_execution')
        )
      ).toBe(true)
    }
  )

  it.each([{ parentPendingExecutionId: 'missing-parent' }, { parentExecutionId: 'processing-1' }])(
    'requires the same-scope active queue parent to borrow capacity: %j',
    async (metadata) => {
      resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce({
        concurrencyLimit: 1,
        displayName: 'Starter',
      })
      txSelectLimitMock.mockResolvedValueOnce([
        {
          ...pendingRow,
          id: 'child-1',
          source: 'workflow_block',
          payload: { metadata },
        },
      ])
      txSelectRowsMock.mockResolvedValueOnce([
        { id: 'processing-1', source: 'workflow_api', payload: {} },
      ])

      await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
        status: 'capacity_blocked',
        pendingExecutionId: 'child-1',
      })
      expect(updateReturningMock).not.toHaveBeenCalled()
      expect(sqlMock.mock.calls.some(([strings]) => strings.join('').includes('case when'))).toBe(
        true
      )
    }
  )

  it('counts an already-processing child whose parent row is absent', async () => {
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValueOnce({
      concurrencyLimit: 1,
      displayName: 'Starter',
    })
    txSelectLimitMock.mockResolvedValueOnce([pendingRow])
    txSelectRowsMock.mockResolvedValueOnce([
      {
        id: 'orphan-child',
        source: 'workflow_block',
        payload: { metadata: { parentPendingExecutionId: 'missing-parent' } },
      },
    ])

    await expect(claimNextPendingExecution('scope-1', 'user')).resolves.toEqual({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-1',
    })
    expect(updateReturningMock).not.toHaveBeenCalled()
  })
})

describe('listChildPendingWorkflowExecutions', () => {
  it.each([
    [{ executionId: 'parent' }, 'parentExecutionId', 'parent'],
    [{ pendingExecutionId: 'parent:resume:2' }, 'parentPendingExecutionId', 'parent:resume:2'],
  ] as const)(
    'queries only the explicitly selected parent identity %j',
    async (parent, key, id) => {
      sqlMock.mockClear()
      selectChain.orderBy.mockResolvedValueOnce([])
      await expect(listChildPendingWorkflowExecutions(parent)).resolves.toEqual([])
      expect(sqlMock).toHaveBeenCalledWith(expect.anything(), 'pendingExecution.payload', key, id)
    }
  )
})

describe('completePendingExecution', () => {
  beforeEach(() => {
    deleteReturningMock.mockResolvedValue([{ billingScopeId: 'scope-1' }])
  })

  it('releases the processing row without admitting work from an empty billing scope', async () => {
    await completePendingExecution({ pendingExecutionId: 'pending-1' })

    expect(deleteReturningMock).toHaveBeenCalledWith({
      billingScopeId: 'pendingExecution.billingScopeId',
      billingScopeType: 'pendingExecution.billingScopeType',
      parentPendingExecutionId: expect.anything(),
    })
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.billingScopeId', 'scope-1')
    expect(idempotencyCreateMock).not.toHaveBeenCalled()
    expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('can settle reconciliation without recursively waking the billing scope', async () => {
    await completePendingExecution({ pendingExecutionId: 'pending-1', wake: false })

    expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it.each(['parent-1', 'parent-1:resume:2'])(
    'releases capacity owner %s and its ancestor after the last nested child is removed',
    async (parentPendingExecutionId) => {
      deleteReturningMock
        .mockResolvedValueOnce([
          {
            billingScopeId: 'scope-1',
            parentPendingExecutionId,
          },
        ])
        .mockResolvedValueOnce([
          {
            billingScopeId: 'scope-1',
            parentPendingExecutionId: 'grandparent-1',
          },
        ])
        .mockResolvedValueOnce([
          {
            billingScopeId: 'scope-1',
            parentPendingExecutionId: null,
          },
        ])
      selectLimitMock
        .mockResolvedValueOnce([
          createPendingRow({
            id: parentPendingExecutionId,
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
      expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', parentPendingExecutionId)
      expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'grandparent-1')
      expect(
        sqlMock.mock.calls.some(
          ([, ...values]) =>
            values.includes('parentPendingExecutionId') && values.includes(parentPendingExecutionId)
        )
      ).toBe(true)
      expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
    }
  )
})

describe('settlePendingExecutionOwner', () => {
  beforeEach(() => {
    getTriggerExecutionStateMock.mockResolvedValue(directExecutionState)
  })

  it('atomically marks an owner that still has a child', async () => {
    selectChain.orderBy.mockResolvedValueOnce([createPendingRow({ id: 'child-1' })])

    await settlePendingExecutionOwner(
      createPendingRow({
        status: 'processing',
        payload: { cancelRequestedAt: '2026-01-01T00:00:00.000Z' },
      }),
      {}
    )

    expect(sqlMock.mock.calls[1]?.[0].join('')).toContain("jsonb_build_object('ownerCompletedAt'")
    expect(sqlMock.mock.calls[1]?.[1]).toBe('pendingExecution.payload')
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ payload: sqlMock.mock.results[1]?.value })
    )
    expect(deleteReturningMock).not.toHaveBeenCalled()
  })

  it('completes an owner directly when it has no children', async () => {
    await settlePendingExecutionOwner(createPendingRow({ status: 'processing' }), {})

    expect(updateChain.set).not.toHaveBeenCalled()
    expect(deleteReturningMock).toHaveBeenCalledOnce()
  })

  it('removes the owner when its last child finished before the marker was written', async () => {
    selectChain.orderBy
      .mockResolvedValueOnce([createPendingRow({ id: 'child-1' })])
      .mockResolvedValueOnce([])
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
        parentPendingExecutionId: null,
      },
    ])

    await settlePendingExecutionOwner(
      createPendingRow({ id: 'parent-1', status: 'processing' }),
      {}
    )

    expect(deleteReturningMock).toHaveBeenCalledOnce()
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'parent-1')
  })
})

describe('cancelPendingWorkflowExecution', () => {
  const pausedCancellation = { pendingExecutionId: 'paused-1', userId: 'user-1' }
  const scopedCancellation = {
    ...pausedCancellation,
    workflowId: 'workflow-1',
  }
  it('holds parent Stop across a timeout and retry until the resumed child owner retires', async () => {
    const target = { ...scopedCancellation, workspaceId: 'workspace-1' }
    const child = {
      id: 'paused-child',
      userId: target.userId,
      workflowId: 'child-workflow',
      workspaceId: 'child-workspace',
    }
    const owner = createPendingRow({
      id: 'paused-child:resume:1',
      userId: child.userId,
      workflowId: child.workflowId,
      workspaceId: child.workspaceId,
      status: 'processing',
      source: 'human_in_the_loop',
      payload: { resumeExecutionId: child.id },
    })
    let retired = false
    let ended = false
    let childReads = 0
    const childLog = {
      id: 'child-log',
      executionId: child.id,
      workflowId: child.workflowId,
      workspaceId: child.workspaceId,
      endedAt: null,
      executionData: { checkpoint: { activeJobId: owner.id } },
    }
    const parentLog = checkpoint()
    selectLimitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([parentLog])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([childLog])
    txSelectLimitMock.mockResolvedValueOnce([parentLog]).mockResolvedValueOnce([childLog])
    updateReturningMock.mockResolvedValueOnce([owner])
    readWorkflowCheckpointChildrenMock.mockImplementation(async (id, includeFinished) =>
      id === target.pendingExecutionId && (!ended || includeFinished)
        ? [{ ...child, endedAt: ended ? new Date() : null }]
        : []
    )
    const originalWhere = selectChain.where.getMockImplementation()!
    selectChain.where.mockImplementation((condition) => {
      const [scope, identity] = condition.args
      if (!scope.args || !identity?.args) return selectChain
      if (!scope.args?.some((term: { value: unknown }) => term?.value === child.workflowId))
        return Promise.resolve([])
      expect(scope.args).toContainEqual({ field: 'pendingExecution.userId', value: child.userId })
      expect(scope.args).toContainEqual({
        field: 'pendingExecution.workspaceId',
        value: child.workspaceId,
      })
      expect(identity.args).toContainEqual({ field: 'pendingExecution.id', value: child.id })
      expect(identity.args[1].args).toContainEqual(
        expect.objectContaining({
          field: expect.objectContaining({ strings: ['', "->>'resumeExecutionId'"] }),
          value: child.id,
        })
      )
      childReads++
      return Promise.resolve(
        retired ? [] : [{ id: owner.id, cancelling: updateReturningMock.mock.calls.length > 0 }]
      )
    })
    const deadline = new AbortController()
    const acknowledged = vi.fn()
    try {
      const initial = { status: 'cancelling' } as const
      await expect(cancelPendingWorkflowExecution(target)).resolves.toEqual(initial)
      expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith(
        target.pendingExecutionId
      )
      cancelPendingExecutionDescendantsMock.mockClear()
      const first = waitForPendingWorkflowExecutionDrain(target, initial, deadline.signal).then(
        acknowledged
      )
      await vi.waitFor(() => expect(childReads + acknowledged.mock.calls.length).toBeGreaterThan(0))
      expect(acknowledged).not.toHaveBeenCalled()
      expect(updateReturningMock).toHaveBeenCalledOnce()
      expect(txSelectChain.for).toHaveBeenCalledWith('update')
      expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', owner.id)
      deadline.abort()
      await expect(first).rejects.toThrow()
      ended = true
      const completedLog = { ...parentLog, endedAt: new Date() }
      selectLimitMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([completedLog])
        .mockResolvedValueOnce([completedLog])
      checkWorkspaceAccessMock.mockResolvedValueOnce({ hasAccess: true })
      const terminal = { status: 'finished' } as const
      await expect(cancelPendingWorkflowExecution(target)).resolves.toEqual(terminal)
      authorizeWorkflowScopeMock.mockResolvedValueOnce({ ok: false })
      await expect(
        waitForPendingWorkflowExecutionDrain(target, terminal, AbortSignal.timeout(5000))
      ).rejects.toThrow('Workflow cancellation could not be verified')
      expect(cancelPendingExecutionDescendantsMock).not.toHaveBeenCalled()
      const readsBeforeRetry = childReads
      const retry = waitForPendingWorkflowExecutionDrain(
        target,
        terminal,
        AbortSignal.timeout(5000)
      ).then(acknowledged)
      await vi.waitFor(() => expect(childReads).toBeGreaterThan(readsBeforeRetry))
      expect(acknowledged).not.toHaveBeenCalled()
      retired = true
      await retry
      expect(acknowledged).toHaveBeenCalledOnce()
      expect(updateReturningMock).toHaveBeenCalledOnce()
      expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith(
        target.pendingExecutionId
      )
    } finally {
      retired = true
      deadline.abort()
      selectChain.where.mockImplementation(originalWhere)
    }
  })
  it('waits for a finished checkpoint owner retained by its child to retire', async () => {
    const target = { ...scopedCancellation, workspaceId: 'workspace-1' }
    const owner = createPendingRow({
      id: 'paused-1:resume:1',
      status: 'processing',
      payload: {
        resumeExecutionId: target.pendingExecutionId,
        ownerCompletedAt: new Date().toISOString(),
      },
    })
    selectChain.where.mockResolvedValueOnce([owner]).mockResolvedValueOnce([])
    const settled = vi.fn()
    const draining = waitForPendingWorkflowExecutionDrain(
      target,
      { status: 'finished', pendingExecutionId: owner.id },
      AbortSignal.timeout(5_000)
    ).then(settled)
    await vi.waitFor(() => expect(selectChain.where).toHaveBeenCalledOnce())
    expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith(
      target.pendingExecutionId
    )
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.userId', target.userId)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.workflowId', target.workflowId)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.workspaceId', target.workspaceId)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', target.pendingExecutionId)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.source', 'human_in_the_loop')
    expect(eqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        strings: ['', "->>'resumeExecutionId'"],
        values: ['pendingExecution.payload'],
      }),
      target.pendingExecutionId
    )
    expect(settled).not.toHaveBeenCalled()
    await draining
    expect(selectChain.where).toHaveBeenCalledTimes(2)
  })
  beforeEach(() => {
    terminalizeWorkflowExecutionMock.mockResolvedValue(undefined)
    cancelPendingExecutionDescendantsMock.mockResolvedValue(undefined)
    readWorkflowCheckpointChildrenMock.mockReset().mockResolvedValue([])
    authorizeWorkflowScopeMock.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
  })

  const checkpoint = (overrides: Record<string, unknown> = {}) => ({
    id: 'log-1',
    executionId: 'paused-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    endedAt: null,
    executionData: {
      environment: { userId: 'user-1' },
      pause: { url: '/resume', revision: 1 },
      checkpoint: {
        revision: 1,
        activeJobId: null,
        encryptedSnapshot: 'encrypted',
        pausePoints: [],
        ...overrides,
      },
    },
  })

  it.each([false, true])(
    'serializes first-pause cancellation on the log lock (pause committed before lock: %s)',
    async (pauseCommitted) => {
      const running = { ...checkpoint(), executionData: { environment: { userId: 'user-1' } } }
      selectLimitMock
        .mockResolvedValueOnce([
          { id: 'paused-1', status: 'processing', workflowId: 'workflow-1', payload: {} },
        ])
        .mockResolvedValueOnce([running])
      txSelectLimitMock.mockResolvedValueOnce([pauseCommitted ? checkpoint() : running])
      updateReturningMock.mockResolvedValue([{ id: 'paused-1' }])

      await expect(
        cancelPendingWorkflowExecution({
          ...pausedCancellation,
          descendantCancellation: true,
        })
      ).resolves.toEqual({ status: 'cancelling', pendingExecutionId: 'paused-1' })

      expect(updateReturningMock).toHaveBeenCalledOnce()
      expect(updateReturningMock.mock.invocationCallOrder[0]).toBeLessThan(
        selectLimitMock.mock.invocationCallOrder[1]
      )
      expect(txSelectChain.for).toHaveBeenCalledWith('update')
      if (pauseCommitted) {
        expect(updateChain.set.mock.calls.at(-1)?.[0].executionData).not.toHaveProperty('pause')
        expect(terminalizeWorkflowExecutionMock).toHaveBeenCalledOnce()
      } else {
        expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'paused-1')
        expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
      }
    }
  )

  it.each([false, true])(
    'finalizes a durable pause without a queue row (descendant cancellation: %s)',
    async (descendantCancellation) => {
      selectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([checkpoint()])
      txSelectLimitMock.mockResolvedValueOnce([checkpoint()])
      await expect(
        cancelPendingWorkflowExecution({
          ...pausedCancellation,
          descendantCancellation,
        })
      ).resolves.toEqual({ status: 'cancelling' })
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          executionData: expect.objectContaining({
            checkpoint: expect.objectContaining({
              activeJobId: null,
              encryptedSnapshot: 'encrypted',
            }),
          }),
        })
      )
      expect(updateChain.set.mock.calls.at(-1)?.[0].executionData).not.toHaveProperty('pause')
      expect(terminalizeWorkflowExecutionMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: 'paused-1',
          userId: 'user-1',
          payload: { resumeExecutionId: 'paused-1' },
        }),
        0,
        'Workflow execution was cancelled'
      )
      if (descendantCancellation) {
        expect(cancelPendingExecutionDescendantsMock).not.toHaveBeenCalled()
      } else {
        expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith('paused-1')
        expect(terminalizeWorkflowExecutionMock.mock.invocationCallOrder[0]).toBeLessThan(
          cancelPendingExecutionDescendantsMock.mock.invocationCallOrder[0]
        )
      }
    }
  )

  it.each(['paused', 'pending', 'processing'] as const)(
    'rejects %s cancellation before writes when workflow access is revoked',
    async (status) => {
      selectLimitMock.mockResolvedValueOnce(
        status === 'paused'
          ? []
          : [
              createPendingRow({
                id: 'paused-1:resume:1',
                status,
                payload: { resumeExecutionId: 'paused-1' },
              }),
            ]
      )
      selectLimitMock.mockResolvedValue([checkpoint()])
      authorizeWorkflowScopeMock.mockResolvedValueOnce({ ok: false, status: 403 })
      expect(await cancelPendingWorkflowExecution(pausedCancellation)).toEqual({
        status: 'not_found',
      })
      expect(transactionMock).not.toHaveBeenCalled()
      expect(updateChain.set).not.toHaveBeenCalled()
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'requests cancellation of the active resume job once (direct attempt: %s)',
    async (directAttempt) => {
      const paused = checkpoint({ activeJobId: 'paused-1:resume:1' })
      selectLimitMock
        .mockResolvedValueOnce(
          directAttempt
            ? [
                createPendingRow({
                  id: 'paused-1:resume:1',
                  status: 'processing',
                  payload: { resumeExecutionId: 'paused-1' },
                }),
              ]
            : []
        )
        .mockResolvedValueOnce([checkpoint()])
      txSelectLimitMock.mockResolvedValueOnce([paused])
      updateReturningMock.mockResolvedValueOnce([{ id: 'paused-1:resume:1' }])
      await expect(
        cancelPendingWorkflowExecution({
          pendingExecutionId: directAttempt ? 'paused-1:resume:1' : 'paused-1',
          userId: 'user-1',
        })
      ).resolves.toEqual({ status: 'cancelling', pendingExecutionId: 'paused-1:resume:1' })
      expect(updateReturningMock).toHaveBeenCalledOnce()
      expect(authorizeWorkflowScopeMock).toHaveBeenCalledOnce()
      expect(eqMock).toHaveBeenCalledWith('pendingExecution.id', 'paused-1:resume:1')
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
      expect(updateChain.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ executionData: expect.anything() })
      )
    }
  )

  it.each([false, true])(
    'returns the processing owner even when its log already finished (resumed: %s)',
    async (resumed) => {
      const pendingExecutionId = resumed ? 'paused-1:resume:1' : 'paused-1'
      const finished = { ...checkpoint(), endedAt: new Date() }
      selectLimitMock
        .mockResolvedValueOnce([
          createPendingRow({
            id: pendingExecutionId,
            status: 'processing',
            payload: resumed ? { resumeExecutionId: 'paused-1' } : {},
          }),
        ])
        .mockResolvedValueOnce([finished])
      txSelectLimitMock.mockResolvedValueOnce([finished])
      updateReturningMock.mockResolvedValueOnce([{ id: pendingExecutionId }])

      await expect(
        cancelPendingWorkflowExecution({ pendingExecutionId, userId: 'user-1' })
      ).resolves.toEqual({ status: 'finished', pendingExecutionId })
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'cancels a committed pause even after activeJobId is cleared (resumed: %s)',
    async (resumed) => {
      const pendingExecutionId = resumed ? 'paused-1:resume:1' : 'paused-1'
      selectLimitMock
        .mockResolvedValueOnce([
          createPendingRow({
            id: pendingExecutionId,
            status: 'processing',
            payload: resumed ? { resumeExecutionId: 'paused-1' } : {},
          }),
        ])
        .mockResolvedValueOnce([checkpoint()])
      txSelectLimitMock.mockResolvedValueOnce([checkpoint()])
      updateReturningMock.mockResolvedValueOnce([{ id: pendingExecutionId }])
      await cancelPendingWorkflowExecution({ pendingExecutionId, userId: 'user-1' })
      expect(eqMock).toHaveBeenCalledWith('workflowExecutionLogs.executionId', 'paused-1')
      if (resumed)
        expect(eqMock).not.toHaveBeenCalledWith(
          'workflowExecutionLogs.executionId',
          pendingExecutionId
        )
      expect(sqlMock.mock.calls.some(([strings]) => strings.join('').includes('activeJobId'))).toBe(
        false
      )
      expect(terminalizeWorkflowExecutionMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: 'paused-1', payload: { resumeExecutionId: 'paused-1' } }),
        0,
        'Workflow execution was cancelled'
      )
      expect(updateChain.set.mock.calls.at(-1)?.[0].executionData).not.toHaveProperty('pause')
    }
  )

  it('binds pending rows and retained logs to the supplied actor, workspace and workflow', async () => {
    await cancelPendingWorkflowExecution({
      ...scopedCancellation,
      workspaceId: 'workspace-bound',
      workflowId: 'original-workflow',
    })
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.userId', 'user-1')
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.workspaceId', 'workspace-bound')
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.workflowId', 'original-workflow')
    expect(eqMock).toHaveBeenCalledWith('workflowExecutionLogs.workspaceId', 'workspace-bound')
    expect(eqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        values: ['workflowExecutionLogs.workflowId', 'workflowExecutionLogs.workflowSummary'],
      }),
      'original-workflow'
    )
  })

  it.each([{ ok: false }, { ok: true, workspaceId: 'moved' }])(
    'cannot cancel an attested pending workflow outside its writable scope (%j)',
    async (access) => {
      const row = createPendingRow()
      selectLimitMock.mockResolvedValueOnce([row])
      authorizeWorkflowScopeMock.mockResolvedValueOnce(access)
      const result = await cancelPendingWorkflowExecution({
        ...scopedCancellation,
        pendingExecutionId: row.id,
      })
      expect(result).toEqual({ status: 'not_found' })
      expect(authorizeWorkflowScopeMock).toHaveBeenCalledWith(
        { success: true, userId: 'user-1' },
        'workflow-1',
        'write'
      )
      expect(updateChain.set).not.toHaveBeenCalled()
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    }
  )

  it.each([null, { ...checkpoint(), executionData: {} }])(
    'does not acknowledge an active execution whose checkpoint disappeared before locking',
    async (locked) => {
      selectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([checkpoint()])
      txSelectLimitMock.mockResolvedValueOnce(locked ? [locked] : [])
      expect(await cancelPendingWorkflowExecution(scopedCancellation)).toEqual({
        status: 'not_found',
      })
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'verifies the retained terminal scope after workflow deletion (access %s)',
    async (hasAccess) => {
      const log = { ...checkpoint(), workflowId: null, endedAt: new Date() }
      selectLimitMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([log])
        .mockResolvedValueOnce([log])
      checkWorkspaceAccessMock.mockResolvedValueOnce({ hasAccess })
      const result = await cancelPendingWorkflowExecution({
        ...scopedCancellation,
        pendingExecutionId: log.executionId,
      })
      expect(result).toEqual({ status: hasAccess ? 'finished' : 'not_found' })
      expect(checkWorkspaceAccessMock).toHaveBeenCalledWith(log.workspaceId, 'user-1')
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    }
  )

  it.each([
    { resuming: false, direct: true },
    { resuming: true, direct: true },
    { resuming: true, direct: false },
  ])(
    'cancels queued workflows without execution capacity (resuming: $resuming, direct: $direct)',
    async ({ resuming, direct }) => {
      const payload = {
        triggerType: 'manual',
        ...(resuming ? { resumeExecutionId: 'paused-1' } : {}),
      }
      const row = createPendingRow({
        source: resuming ? 'human_in_the_loop' : 'workflow_api',
        payload,
      })
      selectLimitMock.mockResolvedValueOnce(direct ? [row] : [])
      if (resuming) {
        const paused = checkpoint({ activeJobId: row.id })
        selectLimitMock.mockResolvedValueOnce([paused])
        txSelectLimitMock.mockResolvedValueOnce([paused])
        updateReturningMock.mockResolvedValueOnce([row])
      }
      updateReturningMock.mockResolvedValueOnce([row])
      deleteReturningMock.mockResolvedValueOnce([{ billingScopeId: 'scope-1' }])

      await expect(
        cancelPendingWorkflowExecution({
          pendingExecutionId: direct ? row.id : 'paused-1',
          userId: 'user-1',
          wake: false,
        })
      ).resolves.toEqual({ status: 'cancelling' })
      expect(terminalizeWorkflowExecutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pending-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          payload,
        }),
        0,
        'Workflow execution was cancelled',
        resuming
      )
      expect(terminalizeWorkflowExecutionMock.mock.invocationCallOrder[0]).toBeLessThan(
        deleteReturningMock.mock.invocationCallOrder[0]
      )
      expect(idempotencyCreateMock).not.toHaveBeenCalled()
      expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
      expect(getTriggerExecutionStateMock).not.toHaveBeenCalled()
      expect(dispatchBackgroundExecutionMock).not.toHaveBeenCalled()
      expect(triggerMock).not.toHaveBeenCalled()
      if (resuming) {
        expect(authorizeWorkflowScopeMock).toHaveBeenCalledOnce()
        expect(txSelectChain.for).toHaveBeenCalledWith('update')
        expect(updateChain.set.mock.calls[0]?.[0]).toHaveProperty('payload')
        expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith('paused-1')
        expect(terminalizeWorkflowExecutionMock.mock.invocationCallOrder[0]).toBeLessThan(
          cancelPendingExecutionDescendantsMock.mock.invocationCallOrder[0]
        )
        expect(cancelPendingExecutionDescendantsMock.mock.invocationCallOrder[0]).toBeLessThan(
          deleteReturningMock.mock.invocationCallOrder[0]
        )
      }
    }
  )

  it.each(['before flag', 'after flag'])(
    'retains asynchronous cancellation when a queued resume starts %s',
    async (started) => {
      const row = createPendingRow({
        id: 'paused-1:resume:1',
        payload: { resumeExecutionId: 'paused-1' },
      })
      const paused = checkpoint({ activeJobId: row.id })
      selectLimitMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([paused])
      txSelectLimitMock.mockResolvedValueOnce([paused])
      updateReturningMock.mockResolvedValueOnce([
        { ...row, status: started === 'before flag' ? 'processing' : 'pending' },
      ])
      if (started === 'after flag') updateReturningMock.mockResolvedValueOnce([])

      await expect(
        cancelPendingWorkflowExecution({ pendingExecutionId: row.id, userId: 'user-1' })
      ).resolves.toEqual({ status: 'cancelling', pendingExecutionId: row.id })
      expect(updateChain.set.mock.calls[0]?.[0]).toHaveProperty('payload')
      expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
      expect(deleteReturningMock).not.toHaveBeenCalled()
      expect(cancelPendingExecutionDescendantsMock).toHaveBeenCalledExactlyOnceWith('paused-1')
    }
  )

  it('keeps a cancelled pending resume retryable when its shared finalizer fails', async () => {
    const row = createPendingRow({
      id: 'paused-1:resume:1',
      source: 'human_in_the_loop',
      payload: { resumeExecutionId: 'paused-1' },
    })
    const paused = checkpoint({ activeJobId: row.id })
    selectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([paused])
    txSelectLimitMock.mockResolvedValueOnce([paused])
    updateReturningMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
    terminalizeWorkflowExecutionMock.mockRejectedValueOnce(new Error('execution log unavailable'))
    const params = { pendingExecutionId: 'paused-1', userId: 'user-1', wake: false }

    await expect(cancelPendingWorkflowExecution(params)).rejects.toThrow(
      'execution log unavailable'
    )
    expect(updateChain.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.anything(),
        status: 'pending',
        processingStartedAt: null,
      })
    )
    expect(deleteReturningMock).not.toHaveBeenCalled()
    expect(cancelPendingExecutionDescendantsMock).not.toHaveBeenCalled()

    selectLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([paused])
    txSelectLimitMock.mockResolvedValueOnce([paused])
    updateReturningMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
    deleteReturningMock.mockResolvedValueOnce([{ billingScopeId: 'scope-1' }])
    await expect(cancelPendingWorkflowExecution(params)).resolves.toEqual({ status: 'cancelling' })
    expect(terminalizeWorkflowExecutionMock).toHaveBeenCalledTimes(2)
    expect(deleteReturningMock).toHaveBeenCalledOnce()
  })

  it('rejects malformed queued payloads instead of finalizing an invented empty payload', async () => {
    const row = { ...createPendingRow(), payload: [] }
    selectLimitMock.mockResolvedValueOnce([row])
    updateReturningMock.mockResolvedValueOnce([row])
    await expect(
      cancelPendingWorkflowExecution({ pendingExecutionId: row.id, userId: 'user-1' })
    ).rejects.toThrow('has an invalid payload')
    expect(terminalizeWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(updateChain.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'pending', processingStartedAt: null })
    )
  })

  it('returns not_found when a worker race removes the pending row', async () => {
    selectLimitMock.mockResolvedValueOnce([createPendingRow()])
    updateReturningMock.mockResolvedValueOnce([])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('commits the processing cancellation flag before checking for a not-yet-created execution log', async () => {
    selectLimitMock.mockResolvedValueOnce([
      createPendingRow({
        status: 'processing',
        payload: { ownerCompletedAt: '2026-01-01T00:00:00.000Z' },
      }),
    ])
    updateReturningMock.mockResolvedValueOnce([{ id: 'pending-1' }])

    await expect(
      cancelPendingWorkflowExecution({
        pendingExecutionId: 'pending-1',
        userId: 'user-1',
      })
    ).resolves.toEqual({ status: 'cancelling', pendingExecutionId: 'pending-1' })

    expect(updateReturningMock.mock.invocationCallOrder[0]).toBeLessThan(
      selectLimitMock.mock.invocationCallOrder[1]
    )
    const cancellation = sqlMock.mock.calls.findIndex(([strings]) =>
      strings.join('').includes("jsonb_build_object('cancelRequestedAt'")
    )
    expect(sqlMock.mock.calls[cancellation]?.[1]).toBe('pendingExecution.payload')
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ payload: sqlMock.mock.results[cancellation]?.value })
    )
  })
})
