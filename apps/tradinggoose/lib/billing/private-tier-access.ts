import { db } from '@tradinggoose/db'
import { privateTierAccess } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'

export async function listPrivateTierAccessTierIdsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ tierId: privateTierAccess.tierId })
    .from(privateTierAccess)
    .where(eq(privateTierAccess.userId, userId))
  return rows.map((row) => row.tierId)
}

export async function upsertPrivateTierAccess(userId: string, tierId: string): Promise<void> {
  await db
    .insert(privateTierAccess)
    .values({ userId, tierId })
    .onConflictDoNothing({
      target: [privateTierAccess.userId, privateTierAccess.tierId],
    })
}

export async function hasPrivateTierAccessRow(userId: string, tierId: string): Promise<boolean> {
  const rows = await db
    .select({ tierId: privateTierAccess.tierId })
    .from(privateTierAccess)
    .where(and(eq(privateTierAccess.userId, userId), eq(privateTierAccess.tierId, tierId)))
    .limit(1)
  return rows.length > 0
}
