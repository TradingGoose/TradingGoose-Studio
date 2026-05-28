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

type MonitorRuntimeLockOptions = {
  key: string
  label: string
  logger: LoggerLike
  expirySeconds?: number
  refreshIntervalMs?: number
  onLost: (error: unknown) => Promise<void> | void
}

const DEFAULT_LOCK_EXPIRY_SECONDS = 90
const DEFAULT_LOCK_REFRESH_INTERVAL_MS = 30_000

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

export class MonitorRuntimeLock {
  private readonly key: string
  private readonly label: string
  private readonly logger: LoggerLike
  private readonly expirySeconds: number
  private readonly refreshIntervalMs: number
  private readonly onLost: (error: unknown) => Promise<void> | void
  private readonly instanceId = randomUUID()
  private held = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: MonitorRuntimeLockOptions) {
    this.key = options.key
    this.label = options.label
    this.logger = options.logger
    this.expirySeconds = options.expirySeconds ?? DEFAULT_LOCK_EXPIRY_SECONDS
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_LOCK_REFRESH_INTERVAL_MS
    this.onLost = options.onLost
  }

  getHealth(status: MonitorRuntimeStatus): MonitorRuntimeLockHealth {
    return getMonitorRuntimeLockHealth(status)
  }

  async acquire() {
    let acquired = false
    try {
      acquired = await acquireLock(this.key, this.instanceId, this.expirySeconds)
    } catch (error) {
      this.logger.warn(`${this.label} runtime lock acquisition error`, { error })
    }

    this.held = acquired
    return acquired
  }

  startRenewal() {
    if (this.refreshTimer) return

    this.refreshTimer = setInterval(() => {
      void this.refresh()
    }, this.refreshIntervalMs)
    this.refreshTimer.unref?.()
  }

  stopRenewal() {
    if (!this.refreshTimer) return
    clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  async release() {
    if (!this.held) return

    try {
      await releaseLock(this.key, this.instanceId)
    } catch (error) {
      this.logger.warn(`Failed to release ${this.label.toLowerCase()} runtime lock`, { error })
    } finally {
      this.held = false
    }
  }

  private async refresh() {
    if (!this.held) return

    try {
      const renewed = await renewLock(this.key, this.instanceId, this.expirySeconds)
      if (renewed) return

      this.held = false
      await this.onLost(new Error(`${this.label} runtime lock ownership was lost`))
    } catch (error) {
      this.held = false
      await this.onLost(error)
    }
  }
}
