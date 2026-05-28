import { randomUUID } from 'node:crypto'
import {
  acquireLock,
  getRedisClient,
  getRedisStorageMode,
  releaseLock,
  renewLock,
} from '@/lib/redis'

export type MonitorRuntimeStatus = 'not_initialized' | 'running' | 'degraded' | 'disabled'

export type MonitorRuntimeLockHealth = {
  mode: 'fail_closed'
  redisConfigured: boolean
  redisClientAvailable: boolean
  degraded: boolean
}

type LoggerLike = {
  warn: (message: string, ...args: unknown[]) => void
}

type RuntimeLockOptions = {
  key: string
  label: string
  logger: LoggerLike
  onLost: (error: unknown) => Promise<void> | void
}

const LOCK_EXPIRY_SECONDS = 90
const LOCK_REFRESH_INTERVAL_MS = 30_000
const DATABASE_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
])

export function isMonitorRuntimeDatabaseConnectionError(error: unknown): boolean {
  const seen = new Set<object>()
  let current: unknown = error

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)

    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && DATABASE_CONNECTION_ERROR_CODES.has(code)) {
      return true
    }

    current = (current as { cause?: unknown }).cause
  }

  return false
}

export const getMonitorRuntimeUnavailableStatus = (): MonitorRuntimeStatus =>
  getRedisStorageMode() === 'redis' ? 'degraded' : 'disabled'

export const getMonitorRuntimeLockHealth = (
  status: MonitorRuntimeStatus
): MonitorRuntimeLockHealth => {
  const redisConfigured = getRedisStorageMode() === 'redis'
  const redisClientAvailable = Boolean(getRedisClient())

  return {
    mode: 'fail_closed',
    redisConfigured,
    redisClientAvailable,
    degraded: status === 'degraded' || (redisConfigured && !redisClientAvailable),
  }
}

export function createMonitorRuntimeLock({ key, label, logger, onLost }: RuntimeLockOptions) {
  const instanceId = randomUUID()
  let held = false
  let timer: ReturnType<typeof setInterval> | null = null

  const release = async () => {
    if (!held) return

    try {
      await releaseLock(key, instanceId)
    } catch (error) {
      logger.warn(`Failed to release ${label.toLowerCase()} runtime lock`, { error })
    } finally {
      held = false
    }
  }

  const refresh = async () => {
    if (!held) return

    try {
      const renewed = await renewLock(key, instanceId, LOCK_EXPIRY_SECONDS)
      if (renewed) return

      held = false
      await onLost(new Error(`${label} runtime lock ownership was lost`))
    } catch (error) {
      held = false
      await onLost(error)
    }
  }

  return {
    getHealth: getMonitorRuntimeLockHealth,
    acquire: async () => {
      try {
        held = await acquireLock(key, instanceId, LOCK_EXPIRY_SECONDS)
      } catch (error) {
        held = false
        logger.warn(`${label} runtime lock acquisition error`, { error })
      }
      return held
    },
    startRenewal: () => {
      if (timer) return
      timer = setInterval(() => void refresh(), LOCK_REFRESH_INTERVAL_MS)
      timer.unref?.()
    },
    stopRenewal: () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
    release,
  }
}
