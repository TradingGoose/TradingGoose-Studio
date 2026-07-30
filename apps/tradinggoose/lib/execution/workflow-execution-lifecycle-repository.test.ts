import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  selectRows: [] as unknown[][],
  requireDatabaseDate: vi.fn(),
  reconcileDeadline: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mocks.transaction },
}))

vi.mock('@tradinggoose/db/schema', () => {
  const table = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, property) => `${name}.${String(property)}`,
      }
    )
  return {
    pendingExecution: table('pendingExecution'),
    workflowExecutionAttempt: table('attempt'),
    workflowExecutionDeadline: table('deadline'),
    workflowExecutionOperation: table('operation'),
    workflowExecutionOutbox: table('outbox'),
    workflowExecutionParticipant: table('participant'),
    workflowExecutionTerminal: table('terminal'),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...values) => values),
  asc: vi.fn((value) => value),
  eq: vi.fn((...values) => values),
  gt: vi.fn((...values) => values),
  inArray: vi.fn((...values) => values),
  isNull: vi.fn((value) => value),
  ne: vi.fn((...values) => values),
  sql: vi.fn(),
}))

vi.mock('./database-date', () => ({
  requireDatabaseDate: mocks.requireDatabaseDate,
}))

vi.mock('./workflow-execution-deadline-repository', () => ({
  reconcileWorkflowExecutionDeadline: vi.fn(),
  reconcileWorkflowExecutionDeadlineInTransaction: mocks.reconcileDeadline,
}))

import {
  cancelWorkflowExecutionAtomically,
  captureRootWorkflowExecution,
  finalizeWorkflowExecution,
  reconcileWorkflowDeadlineTermination,
  recordWorkflowInfrastructureCandidate,
} from './workflow-execution-lifecycle-repository'

const rawTimestamp = '2026-07-29T15:47:39.061Z'
const decoderSentinel = new Error('decoder reached')

function selectChain() {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.limit.mockImplementation(() => Promise.resolve(mocks.selectRows.shift() ?? []))
  return chain
}

describe('workflow lifecycle raw database clocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows = []
    mocks.select.mockImplementation(selectChain)
    mocks.requireDatabaseDate.mockImplementation(() => {
      throw decoderSentinel
    })
    mocks.reconcileDeadline.mockResolvedValue({ state: 'inactive' })
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        execute: mocks.execute,
        select: mocks.select,
      })
    )
  })

  it('normalizes the direct-start clock before lifecycle persistence', async () => {
    mocks.execute.mockResolvedValueOnce([{ now: rawTimestamp }])

    await expect(
      captureRootWorkflowExecution({
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
        triggerType: 'manual',
      })
    ).rejects.toBe(decoderSentinel)
    expect(mocks.requireDatabaseDate).toHaveBeenCalledWith(
      rawTimestamp,
      'processing-start timestamp'
    )
  })

  it('normalizes the durable cancellation-request clock before mutation', async () => {
    mocks.selectRows = [
      [
        {
          id: 'pending-1',
          userId: 'user-1',
          executionType: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          status: 'pending',
          payload: {},
        },
      ],
      [],
    ]
    mocks.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ now: rawTimestamp }])

    await expect(
      cancelWorkflowExecutionAtomically({
        pendingExecutionId: 'pending-1',
        actorUserId: 'user-1',
      })
    ).rejects.toBe(decoderSentinel)
    expect(mocks.requireDatabaseDate).toHaveBeenCalledWith(
      rawTimestamp,
      'cancellation-request timestamp'
    )
  })

  it('accounts a deadline through cancellation before closing dispatch', async () => {
    const requestedAt = new Date(rawTimestamp)
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    updateChain.set.mockReturnValue(updateChain)
    mocks.requireDatabaseDate.mockReturnValueOnce(requestedAt)
    mocks.selectRows = [
      [
        {
          id: 'pending-1',
          userId: 'user-1',
          executionType: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          status: 'pending',
          payload: {},
        },
      ],
      [],
    ]
    mocks.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ now: rawTimestamp }])
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({
        execute: mocks.execute,
        select: mocks.select,
        update: vi.fn(() => updateChain),
      })
    )

    await expect(
      cancelWorkflowExecutionAtomically({
        pendingExecutionId: 'pending-1',
        actorUserId: 'user-1',
      })
    ).rejects.toThrow()
    expect(mocks.reconcileDeadline).toHaveBeenCalledWith(expect.anything(), 'pending-1', {
      terminalCauseAt: requestedAt,
    })
  })

  it('does not terminal-account the root for descendant-only cancellation', async () => {
    const requestedAt = new Date(rawTimestamp)
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    updateChain.set.mockReturnValue(updateChain)
    mocks.requireDatabaseDate.mockReturnValueOnce(requestedAt)
    mocks.selectRows = [
      [
        {
          id: 'pending-1',
          userId: 'user-1',
          executionType: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          status: 'processing',
          payload: {},
        },
      ],
      [{ rootExecutionId: 'root-1' }],
    ]
    mocks.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ now: rawTimestamp }])
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({
        execute: mocks.execute,
        select: mocks.select,
        update: vi.fn(() => updateChain),
      })
    )

    await expect(
      cancelWorkflowExecutionAtomically({
        pendingExecutionId: 'pending-1',
        actorUserId: 'user-1',
        descendantOnly: true,
      })
    ).resolves.toBe(true)
    expect(mocks.reconcileDeadline).not.toHaveBeenCalled()
  })

  it('normalizes the completion clock before participant and attempt writes', async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ now: rawTimestamp }])

    await expect(
      finalizeWorkflowExecution({
        rootExecutionId: 'execution-1',
        attemptId: 'attempt-1',
        result: { success: true, output: {} },
      })
    ).rejects.toBe(decoderSentinel)
    expect(mocks.requireDatabaseDate).toHaveBeenCalledWith(rawTimestamp, 'completion timestamp')
  })

  it('normalizes the terminal-reconciliation clock before the terminal write', async () => {
    mocks.selectRows = [
      [
        {
          state: 'termination_pending',
          result: null,
          resultVersion: 0,
        },
      ],
      [],
      [],
    ]
    mocks.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ cause: 'cancellation' }])
      .mockResolvedValueOnce([{ now: rawTimestamp }])

    await expect(reconcileWorkflowDeadlineTermination('execution-1')).rejects.toBe(decoderSentinel)
    expect(mocks.requireDatabaseDate).toHaveBeenCalledWith(
      rawTimestamp,
      'terminal-reconciliation timestamp'
    )
  })

  it('accounts a deadline through infrastructure failure before closing dispatch', async () => {
    const failedAt = new Date(rawTimestamp)
    mocks.execute.mockResolvedValueOnce(undefined)

    await expect(
      recordWorkflowInfrastructureCandidate({
        attemptId: 'attempt-1',
        rootExecutionId: 'execution-1',
        failedAt,
      })
    ).rejects.toThrow()
    expect(mocks.reconcileDeadline).toHaveBeenCalledWith(expect.anything(), 'execution-1', {
      terminalCauseAt: failedAt,
    })
  })
})
