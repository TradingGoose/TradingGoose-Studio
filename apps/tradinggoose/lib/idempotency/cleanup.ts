import { db } from '@tradinggoose/db'
import { idempotencyKey } from '@tradinggoose/db/schema'
import { and, eq, lt, or } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('IdempotencyCleanup')

export type CleanupOptions = {
  maxAgeSeconds?: number
  batchSize?: number
  namespace?: string
}

export async function cleanupExpiredIdempotencyKeys(options: CleanupOptions = {}): Promise<number> {
  const maxAgeSeconds = options.maxAgeSeconds ?? 7 * 24 * 60 * 60
  const batchSize = options.batchSize ?? 1_000
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1_000)
  let deleted = 0

  logger.info('Starting idempotency key cleanup', {
    cutoffDate: cutoff.toISOString(),
    namespace: options.namespace || 'all',
    batchSize,
  })

  while (true) {
    const expired = options.namespace
      ? and(lt(idempotencyKey.createdAt, cutoff), eq(idempotencyKey.namespace, options.namespace))
      : lt(idempotencyKey.createdAt, cutoff)
    const rows = await db
      .select({ key: idempotencyKey.key, namespace: idempotencyKey.namespace })
      .from(idempotencyKey)
      .where(expired)
      .limit(batchSize)
    if (rows.length === 0) break

    const removed = await db
      .delete(idempotencyKey)
      .where(
        or(
          ...rows.map(({ key, namespace }) =>
            and(eq(idempotencyKey.key, key), eq(idempotencyKey.namespace, namespace))
          )
        )
      )
      .returning({ key: idempotencyKey.key })
    deleted += removed.length
    if (removed.length < batchSize) break
  }

  logger.info('Idempotency key cleanup completed', { deleted })
  return deleted
}
