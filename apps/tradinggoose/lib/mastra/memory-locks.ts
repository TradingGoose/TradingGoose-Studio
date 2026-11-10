import type { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'
import { lockSavedEntityList } from '@/lib/yjs/server/saved-entity-list-lock'
import type { MemoryReadBudget } from './memory-budget'

export type MemoryTransaction = Pick<typeof db, 'execute' | 'select'>
const MEMORY_LOCK_NAMESPACE = 1_904_202_617

export async function lockMemoryOwners(
  tx: MemoryTransaction,
  workspaceId: string,
  workflowIds: string[]
): Promise<void> {
  for (const workflowId of [...new Set(workflowIds)].sort())
    await tx.execute(
      sql`select pg_advisory_xact_lock(${MEMORY_LOCK_NAMESPACE}, hashtext(${JSON.stringify(['workflow-memory-owner', workspaceId, workflowId])}))`
    )
}

export async function lockMemoryKey(
  tx: MemoryTransaction,
  workspaceId: string,
  workflowId: string,
  key: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${MEMORY_LOCK_NAMESPACE}, hashtext(${JSON.stringify(['workflow-memory-key', workspaceId, workflowId, key])}))`
  )
}

export async function lockMemoryMessageIds(tx: MemoryTransaction, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort())
    await tx.execute(
      sql`select pg_advisory_xact_lock(${MEMORY_LOCK_NAMESPACE}, hashtext(${JSON.stringify(['workflow-memory-message', id])}))`
    )
}

/** Continue the same acquisition window after complete physical enumeration. */
export async function lockMemoryKeys(
  tx: MemoryTransaction,
  workspaceId: string,
  workflowId: string,
  keys: string[],
  budget: MemoryReadBudget,
  acquireUntil: number
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    budget.check(acquireUntil)
    await tx.execute(
      sql`select set_config('lock_timeout', ${String(Math.max(1, Math.floor(acquireUntil - budget.now())))}, true)`
    )
    budget.check(acquireUntil)
    await lockMemoryKey(tx, workspaceId, workflowId, key)
    budget.check(acquireUntil)
  }
}

export async function lockMemoryHierarchy(
  tx: MemoryTransaction,
  workspaceId: string,
  workflowId: string,
  key: string | undefined,
  budget: MemoryReadBudget,
  heldDeadline: number
): Promise<number> {
  const acquireUntil = Math.min(budget.now() + 500, heldDeadline, budget.deadline)
  const acquire = async (run: () => Promise<void>) => {
    budget.check(acquireUntil)
    await tx.execute(
      sql`select set_config('lock_timeout', ${String(Math.max(1, Math.floor(acquireUntil - budget.now())))}, true)`
    )
    budget.check(acquireUntil)
    await run()
    budget.check(acquireUntil)
  }
  await acquire(() => lockSavedEntityList(tx, 'workflow', workspaceId))
  await acquire(() => lockMemoryOwners(tx, workspaceId, [workflowId]))
  if (key !== undefined) await acquire(() => lockMemoryKey(tx, workspaceId, workflowId, key))
  return acquireUntil
}
