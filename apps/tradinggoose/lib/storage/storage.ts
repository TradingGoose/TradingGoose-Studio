import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'

const logger = createLogger('Storage')

export type StorageMethod = 'redis' | 'database'

let cachedStorageMethod: StorageMethod | null = null

/**
 * Determine the storage method once based on configuration.
 * This decision is cached for the lifetime of the process.
 *
 * - If REDIS_URL is configured and client initializes -> 'redis'
 * - If REDIS_URL is not configured -> 'database'
 *
 * Transient failures do not change the storage method.
 */
export function getStorageMethod(): StorageMethod {
  if (cachedStorageMethod) return cachedStorageMethod

  const redis = getRedisClient()
  if (redis) {
    cachedStorageMethod = 'redis'
    logger.info('Storage method: Redis')
  } else {
    cachedStorageMethod = 'database'
    logger.info('Storage method: PostgreSQL')
  }

  return cachedStorageMethod
}

export function isRedisStorage(): boolean {
  return getStorageMethod() === 'redis'
}

export function isDatabaseStorage(): boolean {
  return getStorageMethod() === 'database'
}

export function requireRedis() {
  if (!isRedisStorage()) {
    throw new Error('Redis storage not configured')
  }

  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis client unavailable')
  }

  return redis
}

export function resetStorageMethod(): void {
  cachedStorageMethod = null
}
