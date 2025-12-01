import crypto from 'crypto'
import { eq, and, desc } from 'drizzle-orm'
import { db } from './client'
import { copilotKeys } from './schema'

function hashKey(raw: string, userId?: string): string {
  const input = userId ? `${userId}:${raw}` : raw
  return crypto.createHash('sha256').update(input).digest('hex')
}

function randomKey(): string {
  // 32-character hex string
  return crypto.randomBytes(16).toString('hex')
}

export async function createApiKey(userId: string, name?: string): Promise<{ id: string; apiKey: string }> {
  if (!userId) throw new Error('userId is required')
  const apiKey = randomKey()
  const keyHash = hashKey(apiKey, userId)
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const suffix = apiKey.slice(-6)

  await db
    .insert(copilotKeys)
    .values({
      id,
      userId,
      keyHash,
      keySuffix: suffix,
      createdAt,
    })
    .execute()

  return { id, apiKey }
}

export async function listApiKeys(userId: string): Promise<Array<{ id: string; suffix: string }>> {
  if (!userId) return []
  const rows = await db
    .select({ id: copilotKeys.id, suffix: copilotKeys.keySuffix })
    .from(copilotKeys)
    .where(eq(copilotKeys.userId, userId))
    .orderBy(desc(copilotKeys.createdAt))
    .execute()

  return rows.map((r) => ({ id: r.id, suffix: r.suffix || '' }))
}

export async function deleteApiKey(id: string, userId: string): Promise<boolean> {
  if (!id || !userId) return false
  const res = await db
    .delete(copilotKeys)
    .where(and(eq(copilotKeys.id, id), eq(copilotKeys.userId, userId)))
    .returning({ id: copilotKeys.id })
    .execute()
  return Array.isArray(res) && res.length > 0
}

export async function lookupApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
  if (!rawKey) return null
  // Check hash for each userId candidate; stop at first match
  const rows = await db
    .select({ id: copilotKeys.id, userId: copilotKeys.userId, keyHash: copilotKeys.keyHash })
    .from(copilotKeys)
    .orderBy(desc(copilotKeys.createdAt))
    .execute()

  for (const row of rows) {
    if (row.keyHash === hashKey(rawKey, row.userId)) {
      return { userId: row.userId, keyId: row.id }
    }
  }
  return null
}
