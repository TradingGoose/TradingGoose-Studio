import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  createKey: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mocks.trigger },
  idempotencyKeys: { create: mocks.createKey },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    update: mocks.update,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionOutbox: {
    rootExecutionId: 'rootExecutionId',
    kind: 'kind',
    version: 'version',
    fencingToken: 'fencingToken',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((left, right) => [left, right]),
  sql: vi.fn(),
}))

import { dispatchWorkflowExecutionOutbox } from './workflow-execution-outbox'

describe('dispatchWorkflowExecutionOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createKey.mockResolvedValue('global-key')
    mocks.trigger.mockResolvedValue({ id: 'run-1' })
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
  })

  it('uses a fenced claim key and completes only after durable task acceptance', async () => {
    await dispatchWorkflowExecutionOutbox({
      rootExecutionId: 'root-1',
      kind: 'termination_reconcile',
      version: 4,
      payload: { barrierVersion: 4 },
      fencingToken: 'fence-1',
    })

    expect(mocks.createKey).toHaveBeenCalledWith(
      'workflow-lifecycle:root-1:termination_reconcile:4:fence-1',
      { scope: 'global' }
    )
    expect(mocks.trigger).toHaveBeenCalledWith(
      'workflow-execution-termination-reconcile',
      expect.objectContaining({ rootExecutionId: 'root-1', version: 4 }),
      { idempotencyKey: 'global-key' }
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('gives a reclaimed delivery a distinct idempotency identity', async () => {
    await dispatchWorkflowExecutionOutbox({
      rootExecutionId: 'root-1',
      kind: 'pending_execution',
      version: 2,
      payload: {},
      fencingToken: 'fence-1',
    })
    await dispatchWorkflowExecutionOutbox({
      rootExecutionId: 'root-1',
      kind: 'pending_execution',
      version: 2,
      payload: {},
      fencingToken: 'fence-2',
    })

    expect(mocks.createKey).toHaveBeenNthCalledWith(
      1,
      'workflow-lifecycle:root-1:pending_execution:2:fence-1',
      { scope: 'global' }
    )
    expect(mocks.createKey).toHaveBeenNthCalledWith(
      2,
      'workflow-lifecycle:root-1:pending_execution:2:fence-2',
      { scope: 'global' }
    )
  })

  it('requeues the fenced claim when task dispatch fails', async () => {
    mocks.trigger.mockRejectedValueOnce(new Error('dispatch failed'))

    await expect(
      dispatchWorkflowExecutionOutbox({
        rootExecutionId: 'root-1',
        kind: 'workflow_log',
        version: 2,
        payload: {},
        fencingToken: 'fence-2',
      })
    ).rejects.toThrow('dispatch failed')

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'pending',
        fencingToken: null,
        lastError: 'dispatch failed',
      })
    )
  })
})
