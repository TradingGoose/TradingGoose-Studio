import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  selectLimit: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  onConflict: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: mocks.transaction,
    select: mocks.select,
  },
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
    workflowExecutionDeadline: table('deadline'),
    workflowExecutionOperation: table('operation'),
    workflowExecutionOutbox: table('outbox'),
    workflowExecutionParticipant: table('participant'),
    workflowExecutionTerminal: table('terminal'),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((left, right) => [left, right]),
  inArray: vi.fn((left, right) => [left, right]),
  sql: Object.assign(vi.fn(), {
    param: vi.fn((value, encoder) => ({ encoder, value })),
  }),
}))

import {
  reconcileWorkflowExecutionDeadline,
  reconcileWorkflowExecutionDeadlineInTransaction,
} from './workflow-execution-deadline-repository'

describe('workflow deadline reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: mocks.selectLimit,
    }
    const updateChain = {
      set: mocks.updateSet,
    }
    const updateWhereChain = { where: mocks.updateWhere }
    const insertChain = { values: mocks.insertValues }
    const conflictChain = { onConflictDoNothing: mocks.onConflict }
    mocks.select.mockReturnValue(selectChain)
    mocks.update.mockReturnValue(updateChain)
    mocks.updateSet.mockReturnValue(updateWhereChain)
    mocks.updateWhere.mockResolvedValue(undefined)
    mocks.insert.mockReturnValue(insertChain)
    mocks.insertValues.mockReturnValue(conflictChain)
    mocks.onConflict.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        execute: mocks.execute,
        select: mocks.select,
        update: mocks.update,
        insert: mocks.insert,
      })
    )
  })

  it('returns the persisted bounded wake without converting a semantic large limit in JS', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ state: 'running', dispatchOpen: true }])
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      {
        counted_microseconds: '1',
        limit_microseconds: '999999999999999999999999999999',
        exhausted_at: null,
        wake_milliseconds: 60_000,
        schedule_version: 9,
        next_reconcile_at: '2026-01-01T00:01:00.000Z',
      },
    ])

    await expect(reconcileWorkflowExecutionDeadline('root-1')).resolves.toEqual({
      state: 'scheduled',
      delayMilliseconds: 60_000,
    })
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        availableAt: new Date('2026-01-01T00:01:00.000Z'),
        kind: 'deadline_reconcile',
        version: 9,
      })
    )
  })

  it('durably closes admission at the exact database crossing timestamp', async () => {
    const exhaustedAt = new Date('2026-01-01T00:00:00.123456Z')
    mocks.selectLimit.mockResolvedValueOnce([{ state: 'running', dispatchOpen: true }])
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      {
        counted_microseconds: '125',
        limit_microseconds: '125',
        exhausted_at: exhaustedAt.toISOString(),
        wake_milliseconds: 1,
        schedule_version: 3,
        next_reconcile_at: exhaustedAt.toISOString(),
      },
    ])

    await expect(reconcileWorkflowExecutionDeadline('root-1')).resolves.toEqual({
      state: 'exhausted',
      exhaustedAt,
    })
    // The terminal candidate is written by the same SQL CTE that calculates the
    // crossing, so it never round-trips through a millisecond JavaScript Date.
    expect(mocks.updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ deadlineCandidateAt: expect.anything() })
    )
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'termination_reconcile' })
    )
  })

  it('returns inactive without another wake after accounting through a terminal cause', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ state: 'running', dispatchOpen: true }])
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      {
        counted_microseconds: '1',
        limit_microseconds: '100',
        exhausted_at: null,
        wake_milliseconds: 1,
        schedule_version: 10,
        next_reconcile_at: '2026-01-01T00:01:00.000Z',
      },
    ])

    await expect(
      reconcileWorkflowExecutionDeadlineInTransaction(
        {
          execute: mocks.execute,
          select: mocks.select,
          update: mocks.update,
          insert: mocks.insert,
        } as any,
        'root-1',
        {
          terminalCauseAt: new Date('2026-01-01T00:00:30.000Z'),
        }
      )
    ).resolves.toEqual({
      state: 'inactive',
    })
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })
})
