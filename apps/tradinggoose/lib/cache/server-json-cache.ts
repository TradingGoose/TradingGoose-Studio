import { createLogger } from '@/lib/logs/console/logger'
import { deleteCachedValue, getCachedValue, setCachedValue } from '@/lib/redis'

const logger = createLogger('ServerJsonCache')

export async function readServerJsonCache<T>(key: string): Promise<T | null> {
  try {
    const cachedValue = await getCachedValue(key)
    if (!cachedValue) return null
    return JSON.parse(cachedValue) as T
  } catch (error) {
    logger.warn('Failed to read cached JSON value', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    try {
      await deleteCachedValue(key)
    } catch {}
    return null
  }
}

export async function writeServerJsonCache(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    await setCachedValue(key, JSON.stringify(value), ttlSeconds)
  } catch (error) {
    logger.warn('Failed to write cached JSON value', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
