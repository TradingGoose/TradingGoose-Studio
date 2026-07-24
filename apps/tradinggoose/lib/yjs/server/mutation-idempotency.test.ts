import { expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const state: { record?: unknown; pending?: Record<string, unknown> } = {}
  const store: Record<string, any> = { execute: vi.fn() }
  for (const method of ['select', 'from', 'where', 'insert', 'update', 'onConflictDoNothing']) {
    store[method] = () => store
  }
  store.values = (value: Record<string, unknown>) => {
    state.pending = value
    return store
  }
  store.set = (value: Record<string, unknown>) => {
    state.record = value.result
    return store
  }
  store.limit = async () => (state.record === undefined ? [] : [{ result: state.record }])
  store.returning = async () => {
    if (state.record !== undefined) return []
    state.record = state.pending?.result
    return [{ key: state.pending?.key }]
  }
  return { state, store }
})

vi.mock('@tradinggoose/db', () => ({ db: database.store }))

import {
  beginRealtimeMutationTransaction,
  createRealtimeMutation,
  inspectRealtimeMutation,
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

const begin = (
  request: ReturnType<typeof mutation>,
  serializeResult: (result: any) => string = () => 'null'
) =>
  beginRealtimeMutationTransaction(database.store as never, { ...request, serializeResult }, 30_000)

async function execute(
  request: ReturnType<typeof mutation>,
  write: () => Promise<unknown> = async () => undefined
) {
  const before = database.state.record
  try {
    const complete = await begin(request)
    return complete(await write())
  } catch (error) {
    database.state.record = before
    throw error
  }
}

it('reconciles committed, expired, conflicting, and rolled-back realtime mutations', async () => {
  const result = '{"headers":{"Authorization":"[redacted]"}}'
  const claimed = mutation({ fields: { headers: { Authorization: 'secret-token' } } })
  const complete = await begin(claimed, () => result)
  await complete({})

  const recorded = { fingerprint: claimed.fingerprint, result }
  expect(database.state.record).toEqual(recorded)
  expect(JSON.stringify(recorded)).not.toContain('secret-token')
  await expect(inspectRealtimeMutation(claimed)).resolves.toBe(result)
  database.state.record = { fingerprint: claimed.fingerprint }
  await expect(inspectRealtimeMutation(claimed)).rejects.toMatchObject({ status: 500 })
  database.state.record = recorded
  await expect(begin(claimed, () => result)).rejects.toMatchObject({ status: 425 })
  await expect(inspectRealtimeMutation(mutation({ fields: {} }))).rejects.toMatchObject({
    status: 409,
  })

  claimed.deadlineAt = 1
  await expect(inspectRealtimeMutation(claimed)).resolves.toBe(result)
  database.state.record = undefined
  const expired = { ...mutation({}, '2'), deadlineAt: 1 }
  await expect(inspectRealtimeMutation(expired)).rejects.toMatchObject({ status: 408 })

  const request = mutation()
  await expect(
    execute(request, async () => {
      throw new Error('write failed')
    })
  ).rejects.toThrow('write failed')
  await expect(execute(request)).resolves.toBeUndefined()
})
