import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { idempotencyKey } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const MUTATION_NAMESPACE = 'yjs-mutation'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type MutationStore = Pick<typeof db, 'execute' | 'insert' | 'select' | 'update'>

export type RealtimeMutation = {
  requestId: string
  deadlineAt: number
  fingerprint: string
  serializeResult?: (result: any) => string | undefined
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

const header = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? ''

export function createRealtimeMutation(input: {
  requestId: string | string[] | undefined
  deadline: string | string[] | undefined
  method: string
  pathname: string
  actorUserId: string
  body: unknown
}): RealtimeMutation {
  const requestId = header(input.requestId)
  const deadlineAt = Number(header(input.deadline))
  if (!UUID_PATTERN.test(requestId) || !Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) {
    fail(400, 'Valid realtime mutation identity is required')
  }
  return {
    requestId,
    deadlineAt,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          actorUserId: input.actorUserId,
          body: input.body,
          deadlineAt,
          method: input.method.toUpperCase(),
          pathname: input.pathname,
        })
      )
      .digest('hex'),
  }
}

async function recordedMutation(
  store: Pick<MutationStore, 'select'>,
  requestId: string
): Promise<{ fingerprint?: unknown; result?: unknown } | undefined> {
  const [recorded] = await store
    .select({ result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.key, requestId), eq(idempotencyKey.namespace, MUTATION_NAMESPACE)))
    .limit(1)
  return recorded?.result as { fingerprint?: unknown; result?: unknown } | undefined
}

export function getRealtimeMutationTransactionTimeout(
  deadlineAt: number,
  maximumMs: number
): number {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) {
    fail(408, 'Realtime mutation deadline expired')
  }
  return Math.min(maximumMs, remaining)
}

export async function inspectRealtimeMutation(mutation: RealtimeMutation): Promise<string | null> {
  const recorded = await recordedMutation(db, mutation.requestId)
  if (recorded?.fingerprint === mutation.fingerprint) {
    if (typeof recorded.result !== 'string') fail(500, 'Realtime mutation result is incomplete')
    return recorded.result
  }
  if (recorded?.fingerprint !== undefined) {
    fail(409, 'Realtime mutation request ID was reused')
  }
  getRealtimeMutationTransactionTimeout(mutation.deadlineAt, Number.POSITIVE_INFINITY)
  return null
}

export async function beginRealtimeMutationTransaction(
  store: MutationStore,
  mutation: RealtimeMutation | undefined,
  maximumMs: number
): Promise<<T>(result: T) => Promise<T>> {
  const timeoutMs = mutation
    ? getRealtimeMutationTransactionTimeout(mutation.deadlineAt, maximumMs)
    : maximumMs
  await store.execute(
    sql`select set_config('transaction_timeout', ${String(Math.floor(timeoutMs))}, true)`
  )
  if (mutation) {
    const inserted = await store
      .insert(idempotencyKey)
      .values({
        key: mutation.requestId,
        namespace: MUTATION_NAMESPACE,
        result: { fingerprint: mutation.fingerprint },
      })
      .onConflictDoNothing({
        target: [idempotencyKey.key, idempotencyKey.namespace],
      })
      .returning({ key: idempotencyKey.key })
    if (inserted.length === 0) {
      const recorded = await recordedMutation(store, mutation.requestId)
      fail(
        recorded?.fingerprint === mutation.fingerprint ? 425 : 409,
        recorded?.fingerprint === mutation.fingerprint
          ? 'Realtime mutation replay required'
          : 'Realtime mutation request ID was reused'
      )
    }
  }
  return async (result) => {
    if (mutation) {
      const serialized = mutation.serializeResult?.(result)
      if (serialized === undefined) fail(500, 'Realtime mutation result serializer is required')
      await store
        .update(idempotencyKey)
        .set({
          result: { fingerprint: mutation.fingerprint, result: serialized },
        })
        .where(
          and(
            eq(idempotencyKey.key, mutation.requestId),
            eq(idempotencyKey.namespace, MUTATION_NAMESPACE)
          )
        )
    }
    return result
  }
}
