import { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'
import { getRealtimeMutationTransactionTimeout } from './mutation-idempotency'

const YJS_REVOCATION_LOCK_NAMESPACE = 1_904_202_619
const YJS_REVOCATION_COMMIT_FENCE_MS = 60_000

export type YjsRevocationTarget = {
  sessionIds?: readonly string[]
  workspaceIds?: readonly string[]
}

export type NormalizedYjsRevocationTarget = {
  sessionIds: string[]
  workspaceIds: string[]
}

export type YjsRevocationTransaction = Pick<
  typeof db,
  'delete' | 'execute' | 'insert' | 'select' | 'update'
>
type YjsRevocationLockStore = Pick<typeof db, 'execute'>

export class YjsSessionAdmissionError extends Error {
  readonly status = 425

  constructor(target: string) {
    super(`Yjs session ${target} is not accepting connections`)
    this.name = 'YjsSessionAdmissionError'
  }
}

function normalizeIds(ids: readonly string[] | undefined, label: string): string[] {
  const normalized = [...new Set((ids ?? []).map((id) => id.trim()))].sort()
  if (normalized.some((id) => !id)) {
    throw new Error(`Yjs revocation ${label} must contain only non-empty IDs`)
  }
  return normalized
}

export function normalizeYjsRevocationTarget(
  target: YjsRevocationTarget
): NormalizedYjsRevocationTarget {
  const sessionIds = normalizeIds(target.sessionIds, 'sessionIds')
  const workspaceIds = normalizeIds(target.workspaceIds, 'workspaceIds')
  if (sessionIds.length + workspaceIds.length === 0) {
    throw new Error('At least one non-empty Yjs revocation target is required')
  }
  return { sessionIds, workspaceIds }
}

function revocationKeys(target: NormalizedYjsRevocationTarget): string[] {
  return [
    ...target.sessionIds.map((id) => `session:${id}`),
    ...target.workspaceIds.map((id) => `workspace:${id}`),
  ].sort()
}

async function acquireExclusiveLocks(
  tx: YjsRevocationLockStore,
  keys: readonly string[]
): Promise<void> {
  for (const key of keys) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${YJS_REVOCATION_LOCK_NAMESPACE}, hashtext(${key}))`
    )
  }
}

async function tryAcquireSharedLock(tx: YjsRevocationLockStore, key: string): Promise<void> {
  const rows = await tx.execute<{ acquired: boolean }>(
    sql`select pg_try_advisory_xact_lock_shared(${YJS_REVOCATION_LOCK_NAMESPACE}, hashtext(${key})) as acquired`
  )
  if (rows[0]?.acquired !== true) throw new YjsSessionAdmissionError(key)
}

export async function runYjsRevocationTransaction<T>(
  target: YjsRevocationTarget,
  drain: (target: NormalizedYjsRevocationTarget) => Promise<void>,
  mutate: (tx: YjsRevocationTransaction) => Promise<T>,
  options?: { tx?: YjsRevocationTransaction; deadlineAt?: number }
): Promise<T> {
  const normalized = normalizeYjsRevocationTarget(target)
  const revoke = async (store: YjsRevocationTransaction) => {
    await acquireExclusiveLocks(store, revocationKeys(normalized))
    await drain(normalized)
    return mutate(store)
  }
  if (options?.tx) return revoke(options.tx)
  return db.transaction(async (store) => {
    const timeout = String(
      options?.deadlineAt
        ? getRealtimeMutationTransactionTimeout(options.deadlineAt, YJS_REVOCATION_COMMIT_FENCE_MS)
        : YJS_REVOCATION_COMMIT_FENCE_MS
    )
    await store.execute(sql`
      select
        set_config('statement_timeout', ${timeout}, true),
        set_config('idle_in_transaction_session_timeout', ${timeout}, true),
        set_config('transaction_timeout', ${timeout}, true)
    `)
    return revoke(store)
  })
}

export function withYjsAdmissionTransaction<T>(
  target: YjsRevocationTarget,
  use: (
    admitAdditionalTargets: (target: YjsRevocationTarget) => Promise<void>,
    readStore: Pick<YjsRevocationTransaction, 'select'>
  ) => Promise<T>
): Promise<T> {
  const initial = normalizeYjsRevocationTarget(target)
  return db.transaction(async (tx) => {
    const heldKeys = new Set<string>()
    const admitAdditionalTargets = async (additional: YjsRevocationTarget) => {
      for (const key of revocationKeys(normalizeYjsRevocationTarget(additional))) {
        if (heldKeys.has(key)) continue
        await tryAcquireSharedLock(tx, key)
        heldKeys.add(key)
      }
    }
    await admitAdditionalTargets(initial)
    return use(admitAdditionalTargets, tx)
  })
}
