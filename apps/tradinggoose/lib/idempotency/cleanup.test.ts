import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const rows = [
    { key: 'request-1', namespace: 'yjs-mutation' },
    { key: 'poll-1', namespace: 'polling' },
  ]
  const query: Record<string, any> = {}
  const where = vi.fn((_condition: unknown) => query)
  Object.assign(query, {
    from: () => query,
    where,
    limit: async () => rows,
    returning: async () => rows,
  })
  return {
    db: {
      select: () => query,
      delete: () => query,
    },
    where,
  }
})

vi.mock('@tradinggoose/db', () => ({ db: mocks.db }))
vi.mock('@tradinggoose/db/schema', () => ({
  idempotencyKey: { key: 'key', namespace: 'namespace', createdAt: 'createdAt' },
}))
vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ operator: 'and', conditions }),
  eq: (field: unknown, value: unknown) => ({ operator: 'eq', field, value }),
  notLike: (field: unknown, value: unknown) => ({ operator: 'notLike', field, value }),
  lt: (field: unknown, value: unknown) => ({ operator: 'lt', field, value }),
  or: (...conditions: unknown[]) => ({ operator: 'or', conditions }),
}))

import { cleanupExpiredIdempotencyKeys } from './cleanup'

it('deletes a mixed idempotency batch by either composite key', async () => {
  await expect(cleanupExpiredIdempotencyKeys({ batchSize: 3 })).resolves.toBe(2)

  const deletion = mocks.where.mock.lastCall![0] as any
  expect(deletion).toMatchObject({
    operator: 'and',
    conditions: [
      { operator: 'notLike', field: 'namespace', value: 'billing-usage:%' },
      { operator: 'or', conditions: [{ operator: 'and' }, { operator: 'and' }] },
    ],
  })
})

it('protects an explicitly requested financial namespace without reading or deleting it', async () => {
  const calls = mocks.where.mock.calls.length
  await expect(
    cleanupExpiredIdempotencyKeys({ namespace: 'billing-usage:organization:original' })
  ).resolves.toBe(0)
  expect(mocks.where.mock.calls.length).toBe(calls)
})
