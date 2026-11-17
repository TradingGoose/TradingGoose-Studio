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

const inMemoryCache = new Map<string, { value: string; expiry: number | null }>()

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

const readInMemoryCacheEntry = (key: string): { value: string; expiry: number | null } | null => {
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

  const redis = globalRedisClient
  if (!redis) return
  try {
    await redis.quit()
  } catch (error) {
    logger.error('Error closing Redis connection', { error })
  } finally {
    redis.disconnect()
    globalRedisClient = null
  }
}
