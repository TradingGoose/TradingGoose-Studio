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
  lt: (field: unknown, value: unknown) => ({ operator: 'lt', field, value }),
  or: (...conditions: unknown[]) => ({ operator: 'or', conditions }),
}))

import { cleanupExpiredIdempotencyKeys } from './cleanup'

it('deletes a mixed idempotency batch by either composite key', async () => {
  await expect(cleanupExpiredIdempotencyKeys({ batchSize: 3 })).resolves.toBe(2)

  const deletion = mocks.where.mock.lastCall![0] as any
  expect(deletion).toMatchObject({ operator: 'or' })
  expect(deletion.conditions.map(({ operator }: { operator: string }) => operator)).toEqual([
    'and',
    'and',
  ])
})
