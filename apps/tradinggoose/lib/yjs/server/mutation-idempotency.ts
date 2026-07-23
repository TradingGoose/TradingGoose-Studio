import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { idempotencyKey } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const MUTATION_NAMESPACE = 'yjs-mutation'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type MutationStore = Pick<typeof db, 'execute' | 'insert' | 'select'>

export type RealtimeMutation = {
  requestId: string
  deadlineAt: number
  fingerprint: string
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

async function recordedFingerprint(
  store: Pick<MutationStore, 'select'>,
  requestId: string
): Promise<unknown> {
  const [recorded] = await store
    .select({ result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.key, requestId), eq(idempotencyKey.namespace, MUTATION_NAMESPACE)))
    .limit(1)
  const result = recorded?.result as { fingerprint?: unknown } | undefined
  return result?.fingerprint
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

export async function inspectRealtimeMutation(
  mutation: RealtimeMutation
): Promise<'apply' | 'replay'> {
  const recorded = await recordedFingerprint(db, mutation.requestId)
  if (recorded === mutation.fingerprint) return 'replay'
  if (recorded !== undefined) {
    fail(409, 'Realtime mutation request ID was reused')
  }
  getRealtimeMutationTransactionTimeout(mutation.deadlineAt, Number.POSITIVE_INFINITY)
  return 'apply'
}

export async function prepareRealtimeMutationTransaction(
  store: MutationStore,
  mutation: RealtimeMutation | undefined,
  maximumMs: number
): Promise<void> {
  const timeoutMs = mutation
    ? getRealtimeMutationTransactionTimeout(mutation.deadlineAt, maximumMs)
    : maximumMs
  await store.execute(
    sql`select set_config('transaction_timeout', ${String(Math.floor(timeoutMs))}, true)`
  )
  if (!mutation) return
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
  if (inserted.length > 0) return
  const recorded = await recordedFingerprint(store, mutation.requestId)
  fail(
    recorded === mutation.fingerprint ? 425 : 409,
    recorded === mutation.fingerprint
      ? 'Realtime mutation replay required'
      : 'Realtime mutation request ID was reused'
  )
}
