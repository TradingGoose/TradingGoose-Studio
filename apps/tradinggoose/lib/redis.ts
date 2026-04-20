import Redis from 'ioredis'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Redis')
const redisUrl = env.REDIS_URL

export type RedisStorageMode = 'redis' | 'local'

export function getRedisStorageMode(): RedisStorageMode {
  return redisUrl ? 'redis' : 'local'
}

const isLocalStorageMode = () => getRedisStorageMode() === 'local'

let globalRedisClient: Redis | null = null
let pingFailures = 0
let pingInterval: NodeJS.Timeout | null = null
let pingInFlight = false

const PING_INTERVAL_MS = 15_000
const MAX_PING_FAILURES = 2

const reconnectListeners: Array<() => void> = []

export function onRedisReconnect(cb: () => void): void {
  reconnectListeners.push(cb)
}

const inMemoryCache = new Map<string, { value: string; expiry: number | null }>()
const MAX_CACHE_SIZE = 1000
const MESSAGE_ID_PREFIX = 'processed:'
const MESSAGE_ID_EXPIRY = 60 * 60 * 24 * 7

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

const RENEW_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`

const readInMemoryCacheEntry = (
  key: string
): { value: string; expiry: number | null } | null => {
  const cacheEntry = inMemoryCache.get(key)
  if (!cacheEntry) return null
  if (cacheEntry.expiry && cacheEntry.expiry <= Date.now()) {
    inMemoryCache.delete(key)
    return null
  }
  return cacheEntry
}

const setInMemoryCacheValue = (key: string, value: string, expirySeconds?: number) => {
  inMemoryCache.set(key, {
    value,
    expiry: expirySeconds ? Date.now() + expirySeconds * 1000 : null,
  })
}

const pruneInMemoryCache = () => {
  if (inMemoryCache.size <= MAX_CACHE_SIZE) return
  const now = Date.now()

  for (const [cacheKey, entry] of inMemoryCache.entries()) {
    if (entry.expiry && entry.expiry < now) {
      inMemoryCache.delete(cacheKey)
    }
  }

  if (inMemoryCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(inMemoryCache.keys()).slice(0, inMemoryCache.size - MAX_CACHE_SIZE)
    for (const cacheKey of keysToDelete) {
      inMemoryCache.delete(cacheKey)
    }
  }
}

const ensureRedisAvailable = (operation: string): Redis | null => {
  const redis = getRedisClient()
  if (redis) return redis
  if (isLocalStorageMode()) return null
  throw new Error(`Redis is configured but unavailable for ${operation}`)
}

function startPingHealthCheck(redis: Redis): void {
  if (pingInterval) return

  pingInterval = setInterval(async () => {
    if (pingInFlight) return
    pingInFlight = true
    try {
      await redis.ping()
      pingFailures = 0
    } catch (error) {
      pingFailures++
      logger.warn('Redis PING failed', {
        consecutiveFailures: pingFailures,
        error: error instanceof Error ? error.message : String(error),
      })

      if (pingFailures >= MAX_PING_FAILURES) {
        pingFailures = 0
        for (const cb of reconnectListeners) {
          try {
            cb()
          } catch (callbackError) {
            logger.error('Redis reconnect listener error', { error: callbackError })
          }
        }
        try {
          redis.disconnect(true)
        } catch (disconnectError) {
          logger.error('Error during forced Redis disconnect', { error: disconnectError })
        }
      }
    } finally {
      pingInFlight = false
    }
  }, PING_INTERVAL_MS)
  pingInterval.unref?.()
}

export function getRedisClient(): Redis | null {
  if (typeof window !== 'undefined') return null
  if (!redisUrl) return null
  if (globalRedisClient) return globalRedisClient

  try {
    globalRedisClient = new Redis(redisUrl, {
      keepAlive: 1000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 5,
      enableOfflineQueue: true,
      retryStrategy: (times) => {
        if (times > 10) return 30000
        const base = Math.min(1000 * 2 ** (times - 1), 10000)
        const jitter = Math.random() * base * 0.3
        return Math.round(base + jitter)
      },
      reconnectOnError: (error) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']
        return targetErrors.some((target) => error.message.includes(target))
      },
    })

    globalRedisClient.on('error', (error: Error) => {
      logger.error('Redis error', { error: error.message, code: (error as any).code })
    })

    globalRedisClient.on('end', () => {
      globalRedisClient = null
    })

    startPingHealthCheck(globalRedisClient)
    return globalRedisClient
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error })
    return null
  }
}

export async function hasProcessedMessage(key: string): Promise<boolean> {
  const fullKey = `${MESSAGE_ID_PREFIX}${key}`
  const redis = ensureRedisAvailable('hasProcessedMessage')
  if (redis) {
    return (await redis.exists(fullKey)) === 1
  }
  return readInMemoryCacheEntry(fullKey) !== null
}

export async function markMessageAsProcessed(
  key: string,
  expirySeconds: number = MESSAGE_ID_EXPIRY
): Promise<void> {
  const fullKey = `${MESSAGE_ID_PREFIX}${key}`
  const redis = ensureRedisAvailable('markMessageAsProcessed')
  if (redis) {
    await redis.set(fullKey, '1', 'EX', expirySeconds)
    return
  }

  setInMemoryCacheValue(fullKey, '1', expirySeconds)
  pruneInMemoryCache()
}

export async function hasCachedValue(key: string): Promise<boolean> {
  const redis = ensureRedisAvailable('hasCachedValue')
  if (redis) {
    return (await redis.exists(key)) === 1
  }
  return readInMemoryCacheEntry(key) !== null
}

export async function getCachedValue(key: string): Promise<string | null> {
  const redis = ensureRedisAvailable('getCachedValue')
  if (redis) {
    return await redis.get(key)
  }
  return readInMemoryCacheEntry(key)?.value ?? null
}

export async function setCachedValue(
  key: string,
  value: string,
  expirySeconds?: number
): Promise<void> {
  const redis = ensureRedisAvailable('setCachedValue')
  if (redis) {
    if (expirySeconds && expirySeconds > 0) {
      await redis.set(key, value, 'EX', expirySeconds)
    } else {
      await redis.set(key, value)
    }
    return
  }

  setInMemoryCacheValue(key, value, expirySeconds)
}

export async function deleteCachedValue(key: string): Promise<void> {
  const redis = ensureRedisAvailable('deleteCachedValue')
  if (redis) {
    await redis.del(key)
    return
  }
  inMemoryCache.delete(key)
}

export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = ensureRedisAvailable('acquireLock')
  if (!redis) {
    return true
  }
  const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
  return result === 'OK'
}

export async function releaseLock(lockKey: string, value: string): Promise<boolean> {
  const redis = ensureRedisAvailable('releaseLock')
  if (redis) {
    const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, value)
    return Number(result) === 1
  }

  return true
}

export async function renewLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = ensureRedisAvailable('renewLock')
  if (redis) {
    const result = await redis.eval(
      RENEW_LOCK_SCRIPT,
      1,
      lockKey,
      value,
      Math.max(1, Math.ceil(expirySeconds))
    )
    return Number(result) === 1
  }

  return true
}

export async function closeRedisConnection(): Promise<void> {
  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }
  pingFailures = 0
  pingInFlight = false

  if (!globalRedisClient) return
  try {
    await globalRedisClient.quit()
  } catch (error) {
    logger.error('Error closing Redis connection', { error })
  } finally {
    globalRedisClient = null
  }
}
