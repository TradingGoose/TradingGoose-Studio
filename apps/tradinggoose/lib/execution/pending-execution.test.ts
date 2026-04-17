/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  triggerMock,
  deleteWhereMock,
  isBillingEnabledForRuntimeMock,
  ensureTriggerExecutionEnabledMock,
  andMock,
  eqMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  triggerMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  isBillingEnabledForRuntimeMock: vi.fn(),
  ensureTriggerExecutionEnabledMock: vi.fn(),
  andMock: vi.fn((...args) => ({ args })),
  eqMock: vi.fn((field, value) => ({ field, value })),
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

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: transactionMock,
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
    completedAt: 'pendingExecution.completedAt',
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
  inArray: vi.fn(),
  lte: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: isBillingEnabledForRuntimeMock,
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingContext: vi.fn(),
}))

vi.mock('@/lib/trigger/settings', () => ({
  ensureTriggerExecutionEnabled: ensureTriggerExecutionEnabledMock,
}))

import { enqueuePendingExecution } from './pending-execution'

describe('enqueuePendingExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isBillingEnabledForRuntimeMock.mockResolvedValue(false)
    ensureTriggerExecutionEnabledMock.mockResolvedValue(undefined)
    txSelectLimitMock.mockResolvedValue([])
    txInsertValuesMock.mockResolvedValue(undefined)
    transactionMock.mockImplementation(async (callback) =>
      callback({
        select: vi.fn(() => txSelectChain),
        insert: vi.fn(() => txInsertChain),
      }),
    )
  })

  it('deletes a newly inserted row when the drain trigger fails', async () => {
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
      }),
    ).rejects.toThrow('Trigger unavailable')

    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.status', 'pending')
    expect(andMock).toHaveBeenCalled()
  })
})
