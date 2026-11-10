import type { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'
import type { SavedEntityListLockKind } from './entity-loaders'

/** Shared transaction barrier for canonical list mutation and complete workflow Memory reads. */
export async function lockSavedEntityList(
  tx: Pick<typeof db, 'execute'>,
  entityKind: SavedEntityListLockKind,
  workspaceId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(1904202618, hashtext(${`${entityKind}:${workspaceId}`}))`
  )
}
