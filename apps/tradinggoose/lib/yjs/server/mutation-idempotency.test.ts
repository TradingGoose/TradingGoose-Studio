import { afterEach, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  let result: unknown
  let inserted: Record<string, unknown> | undefined
  const store: Record<string, any> = { execute: vi.fn() }
  store.select = store.from = store.where = store.insert = store.onConflictDoNothing = () => store
  store.values = (value: Record<string, unknown>) => {
    inserted = value
    return store
  }
  store.limit = async () => (result === undefined ? [] : [{ result }])
  store.returning = async () => {
    if (result !== undefined) return []
    result = inserted?.result
    return [{ key: inserted?.key }]
  }
  return {
    store,
    inserted: () => inserted,
    reset: () => {
      result = undefined
    },
    transaction: async (run: (tx: typeof store) => Promise<unknown>) => {
      try {
        return await run(store)
      } catch (error) {
        result = undefined
        throw error
      }
    },
  }
})

vi.mock('@tradinggoose/db', () => ({ db: database.store }))

import {
  createRealtimeMutation,
  getRealtimeMutationTransactionTimeout,
  inspectRealtimeMutation,
  prepareRealtimeMutationTransaction,
} from './mutation-idempotency'

const mutation = (body: unknown = {}, suffix = '1') =>
  createRealtimeMutation({
    requestId: `00000000-0000-4000-8000-00000000000${suffix}`,
    deadline: String(Date.now() + 40_000),
    method: 'POST',
    pathname: '/internal/yjs/entities/watchlist-1/apply-state',
    actorUserId: 'user-1',
    body,
  })

afterEach(() => vi.useRealTimers())

it('reconciles committed, expired, conflicting, and rolled-back realtime mutations', async () => {
  const claimed = mutation({ fields: { headers: { Authorization: 'secret-token' } } })
  const uncommitted = mutation({}, '2')
  await prepareRealtimeMutationTransaction(database.store as never, claimed, 30_000)

  expect(database.inserted()).toMatchObject({
    key: claimed.requestId,
    namespace: 'yjs-mutation',
    result: { fingerprint: claimed.fingerprint },
  })
  expect(JSON.stringify(database.inserted())).not.toContain('secret-token')
  await expect(inspectRealtimeMutation(claimed)).resolves.toBe('replay')
  const replayRace = prepareRealtimeMutationTransaction(database.store as never, claimed, 30_000)
  await expect(replayRace).rejects.toMatchObject({ status: 425 })
  const conflicting = inspectRealtimeMutation(mutation({ fields: {} }))
  await expect(conflicting).rejects.toMatchObject({ status: 409 })

  vi.useFakeTimers()
  vi.setSystemTime(claimed.deadlineAt + 1)
  await expect(inspectRealtimeMutation(claimed)).resolves.toBe('replay')
  database.reset()
  await expect(inspectRealtimeMutation(uncommitted)).rejects.toMatchObject({ status: 408 })

  vi.setSystemTime(1_000_000)
  const request = mutation()
  expect(getRealtimeMutationTransactionTimeout(Date.now() + 20_000, 30_000)).toBe(20_000)
  await expect(
    database.transaction(async (tx) => {
      await prepareRealtimeMutationTransaction(tx as never, request, 30_000)
      throw new Error('write failed')
    })
  ).rejects.toThrow('write failed')
  await expect(
    database.transaction((tx) => prepareRealtimeMutationTransaction(tx as never, request, 30_000))
  ).resolves.toBeUndefined()
})
