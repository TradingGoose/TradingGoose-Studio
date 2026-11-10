/** @vitest-environment node */
import { db } from '@tradinggoose/db'
import { idempotencyKey, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { beforeEach, expect, it, vi } from 'vitest'
import { ExecutionLogger } from './logger'

const pool = vi.hoisted(() => ({
  reserved: false,
  tail: Promise.resolve() as Promise<unknown>,
  reads: new Set<unknown>(),
  policyCalls: 0,
  failPolicy: false,
  binding: {
    namespace: 'billing-usage:user:original',
    key: 'invocation:execution',
    fingerprint: 'original',
    runId: 'execution',
    workspaceId: 'workspace',
    actorUserId: 'actor',
    workflowId: 'workflow',
    purpose: 'workflow-execution',
  },
}))
vi.mock('@tradinggoose/db', async () => {
  const schema = await import('@tradinggoose/db/schema')
  const connection = (pooled: boolean) => {
    const query = () => {
      let table: unknown
      const chain = {
        from: (target: unknown) => {
          table = target
          return chain
        },
        where: () => chain,
        limit: () => chain,
        then: (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (pooled && pool.reserved) throw new Error('Database pool exhausted')
              pool.reads.add(table)
              return table === schema.workflowExecutionLogs
                ? [
                    {
                      executionId: 'execution',
                      workspaceId: 'workspace',
                      trigger: 'api',
                      executionData: { billing: { binding: pool.binding } },
                    },
                  ]
                : []
            })
            .then(resolve, reject),
      }
      return chain
    }
    return { select: () => query() }
  }
  return {
    db: {
      ...connection(true),
      transaction: (callback: (tx: ReturnType<typeof connection>) => Promise<unknown>) => {
        const result = pool.tail.then(async () => {
          pool.reserved = true
          try {
            return await callback(connection(false))
          } finally {
            pool.reserved = false
          }
        })
        pool.tail = result.catch(() => {})
        return result
      },
    },
  }
})
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  acceptModelStep: async (
    tx: typeof db,
    binding: unknown,
    occurrence: unknown,
    options: unknown
  ) => {
    expect(binding).toEqual(pool.binding)
    expect(occurrence).toEqual({ stepNumber: 0, retryCount: 0 })
    expect(options).toEqual({ executionTrigger: 'api' })
    // The shared package performs its reads on this supplied transaction, never a second pool checkout.
    await tx.select().from(idempotencyKey).limit(1)
    pool.policyCalls++
    if (pool.failPolicy) throw new Error('financial policy unavailable')
    return { appliedUsd: '0.25' }
  },
}))
vi.mock('@/lib/billing/native-finance', () => ({}))
vi.mock('@/lib/logs/events', () => ({}))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({ snapshotService: {} }))
vi.mock('@/lib/mastra/workflow-history', () => ({}))
vi.mock('@/lib/permissions/utils', () => ({}))

beforeEach(() => {
  pool.reserved = false
  pool.tail = Promise.resolve()
  pool.reads.clear()
  pool.policyCalls = 0
  pool.failPolicy = false
})

it.each([false, true])(
  'uses one connection for pinned settlement (caller transaction=%s)',
  async (callerOwned) => {
    const logger = new ExecutionLogger()
    const receipts = await Promise.all(
      Array.from({ length: 30 }, () =>
        callerOwned
          ? db.transaction((tx) => logger.settleWorkflowExecutionUsage('execution', tx))
          : logger.settleWorkflowExecutionUsage('execution')
      )
    )
    expect(pool.reserved).toBe(false)
    expect(pool.policyCalls).toBe(30)
    expect(pool.reads).toEqual(new Set([workflowExecutionLogs, idempotencyKey]))
    expect(receipts).toEqual(
      Array.from({ length: 30 }, () => ({ binding: pool.binding, appliedUsd: '0.25' }))
    )
  }
)

it('releases its connection after shared financial policy failure', async () => {
  pool.failPolicy = true
  await expect(new ExecutionLogger().settleWorkflowExecutionUsage('execution')).rejects.toThrow(
    'financial policy unavailable'
  )
  expect(pool.reserved).toBe(false)
  pool.failPolicy = false
  await expect(new ExecutionLogger().settleWorkflowExecutionUsage('execution')).resolves.toEqual({
    binding: pool.binding,
    appliedUsd: '0.25',
  })
})
