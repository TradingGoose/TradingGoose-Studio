import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { copilotKeys, user } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { env } from '@/lib/env'

/** Shared canonical rows and the existing tgc/HMAC pepper contract; no conversion or backfill. */
export async function createCopilotApiKey(userId: string) {
  if (!env.INTERNAL_API_SECRET) throw new Error('INTERNAL_API_SECRET is required')
  const pepper = env.INTERNAL_API_SECRET
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
    if (!owner) throw new Error('Authenticated key owner is unavailable')
    const active = await tx
      .select({ id: copilotKeys.id })
      .from(copilotKeys)
      .where(and(eq(copilotKeys.userId, userId), eq(copilotKeys.status, 'active')))
    if (active.length >= 10) throw new Error('User has reached the maximum of 10 active keys')
    const id = randomUUID()
    const publicId = randomBytes(8).toString('base64url')
    const secret = randomBytes(24).toString('base64url')
    await tx.insert(copilotKeys).values({
      id,
      publicId,
      userId,
      secretHash: createHmac('sha256', pepper).update(secret).digest('hex'),
      suffix: secret.slice(-6),
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    return { id, apiKey: `tgc_${publicId}_${secret}` }
  })
}

export async function listCopilotApiKeys(userId: string) {
  return db
    .select({
      id: copilotKeys.id,
      suffix: copilotKeys.suffix,
      status: copilotKeys.status,
      revokedAt: copilotKeys.revokedAt,
      expiresAt: copilotKeys.expiresAt,
    })
    .from(copilotKeys)
    .where(eq(copilotKeys.userId, userId))
    .orderBy(desc(copilotKeys.createdAt))
}

export async function revokeCopilotApiKey(id: string, userId: string) {
  const changed = await db
    .update(copilotKeys)
    .set({ status: 'revoked', revokedAt: new Date().toISOString() })
    .where(
      and(eq(copilotKeys.id, id), eq(copilotKeys.userId, userId), eq(copilotKeys.status, 'active'))
    )
    .returning({ id: copilotKeys.id })
  return changed.length > 0
}
