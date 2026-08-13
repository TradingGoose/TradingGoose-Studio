import type { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'

export const PENDING_EXECUTION_MODE_LOCK_ID = 29_402
export const LOCAL_PENDING_EXECUTION_DISPATCHER_LOCK_ID = 29_403

export async function lockPendingExecutionMode(store: Pick<typeof db, 'execute'>) {
  await store.execute(sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_MODE_LOCK_ID})`)
}
