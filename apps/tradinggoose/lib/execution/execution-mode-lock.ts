import type { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'

const PENDING_EXECUTION_MODE_LOCK_ID = 29_402

export async function lockPendingExecutionMode(store: Pick<typeof db, 'execute'>) {
  await store.execute(sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_MODE_LOCK_ID})`)
}
