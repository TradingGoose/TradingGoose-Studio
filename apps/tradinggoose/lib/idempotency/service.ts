import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { idempotencyKey } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'
import { getStorageMethod, type StorageMethod } from '@/lib/storage'

const logger = createLogger('IdempotencyService')
const DEFAULT_TTL = 60 * 60 * 24 * 7
const REDIS_KEY_PREFIX = 'idempotency:'
const MAX_WAIT_TIME_MS = 300_000
const POLL_INTERVAL_MS = 1_000

type IdempotencyConfig = {
  ttlSeconds?: number
  namespace?: string
}

type ProcessingResult = {
  result?: unknown
  status: 'in-progress' | 'completed'
}

export class IdempotencyService {
  private config: Required<IdempotencyConfig>
  private storageMethod: StorageMethod

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL,
      namespace: config.namespace ?? 'default',
    }
    this.storageMethod = getStorageMethod()
  }

  private redis() {
    const redis = getRedisClient()
    if (!redis) throw new Error('Redis not available')
    return redis
  }

  private keyCondition(normalizedKey: string) {
    return and(
      eq(idempotencyKey.key, normalizedKey),
      eq(idempotencyKey.namespace, this.config.namespace)
    )
  }

  private normalizeKey(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, unknown>
  ): string {
    const base = `${this.config.namespace}:${provider}:${identifier}`
    const keys = Object.keys(additionalContext ?? {}).sort()
    return keys.length === 0
      ? base
      : `${base}:${keys.map((key) => `${key}=${additionalContext![key]}`).join('&')}`
  }

  private async readDatabaseResult(normalizedKey: string): Promise<ProcessingResult | undefined> {
    const [existing] = await db
      .select({ result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(this.keyCondition(normalizedKey))
      .limit(1)
    return existing?.result as ProcessingResult | undefined
  }

  private async readResult(normalizedKey: string): Promise<ProcessingResult | undefined> {
    if (this.storageMethod === 'database') return this.readDatabaseResult(normalizedKey)
    const data = await this.redis().get(`${REDIS_KEY_PREFIX}${normalizedKey}`)
    return data ? (JSON.parse(data) as ProcessingResult) : undefined
  }

  private async claim(normalizedKey: string) {
    const pending: ProcessingResult = { status: 'in-progress' }
    if (this.storageMethod === 'redis') {
      const redis = this.redis()
      const claimed =
        (await redis.set(
          `${REDIS_KEY_PREFIX}${normalizedKey}`,
          JSON.stringify(pending),
          'EX',
          this.config.ttlSeconds,
          'NX'
        )) === 'OK'
      return {
        claimed,
        existingResult: claimed ? undefined : await this.readResult(normalizedKey),
        normalizedKey,
      }
    }

    const inserted = await db
      .insert(idempotencyKey)
      .values({
        key: normalizedKey,
        namespace: this.config.namespace,
        result: pending,
      })
      .onConflictDoNothing({
        target: [idempotencyKey.key, idempotencyKey.namespace],
      })
      .returning({ key: idempotencyKey.key })
    return {
      claimed: inserted.length > 0,
      existingResult:
        inserted.length > 0 ? undefined : await this.readDatabaseResult(normalizedKey),
      normalizedKey,
    }
  }

  private async waitForResult<T>(normalizedKey: string): Promise<T> {
    const deadline = Date.now() + MAX_WAIT_TIME_MS
    while (Date.now() < deadline) {
      const current = await this.readResult(normalizedKey)
      if (current?.status === 'completed') {
        return current.result as T
      }
      if (!current) throw new Error(`Idempotency operation did not complete: ${normalizedKey}`)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`Timeout waiting for idempotency operation to complete: ${normalizedKey}`)
  }

  private async storeResult(normalizedKey: string, result: ProcessingResult): Promise<void> {
    if (this.storageMethod === 'redis') {
      await this.redis().setex(
        `${REDIS_KEY_PREFIX}${normalizedKey}`,
        this.config.ttlSeconds,
        JSON.stringify(result)
      )
      return
    }
    await db
      .update(idempotencyKey)
      .set({ result, createdAt: new Date() })
      .where(this.keyCondition(normalizedKey))
  }

  private async releaseClaim(normalizedKey: string): Promise<void> {
    if (this.storageMethod === 'redis') {
      await this.redis().del(`${REDIS_KEY_PREFIX}${normalizedKey}`)
      return
    }
    await db.delete(idempotencyKey).where(this.keyCondition(normalizedKey))
  }

  async executeWithIdempotency<T>(
    provider: string,
    identifier: string,
    operation: () => Promise<T>,
    additionalContext?: Record<string, unknown>
  ): Promise<T> {
    const claim = await this.claim(this.normalizeKey(provider, identifier, additionalContext))
    if (!claim.claimed) {
      if (claim.existingResult?.status === 'completed') {
        return claim.existingResult.result as T
      }
      if (claim.existingResult?.status === 'in-progress') {
        return this.waitForResult<T>(claim.normalizedKey)
      }
      throw new Error('Idempotency key was claimed without a result')
    }

    try {
      const result = await operation()
      await this.storeResult(claim.normalizedKey, { result, status: 'completed' })
      return result
    } catch (error) {
      await this.releaseClaim(claim.normalizedKey).catch((releaseError) =>
        logger.warn(`Failed to release idempotency claim ${claim.normalizedKey}:`, releaseError)
      )
      throw error
    }
  }

  static createWebhookIdempotencyKey(webhookId: string, headers?: Record<string, string>): string {
    const normalized = headers
      ? Object.fromEntries(
          Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
        )
      : {}
    const headerId = [
      'webhook-id',
      'x-webhook-id',
      'x-shopify-webhook-id',
      'x-github-delivery',
      'x-event-id',
      'x-teams-notification-id',
    ]
      .map((key) => normalized[key])
      .find(Boolean)
    return `${webhookId}:${headerId || randomUUID()}`
  }
}

export const pollingIdempotency = new IdempotencyService({
  namespace: 'polling',
  ttlSeconds: 60 * 60 * 24 * 3,
})
