import { randomUUID } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { pineIndicators, webhook, workflow } from '@tradinggoose/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import { env, isTruthy } from '@/lib/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { IdempotencyService } from '@/lib/idempotency'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import {
  applyIndicatorTriggerPayloadBudget,
  buildIndicatorTriggerDispatchPayload,
  buildLiveIndicatorTriggerEventId,
  resolveDispatchIntervalMs,
  resolveLatestBarOpenTimeSec,
} from '@/lib/indicators/dispatch'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { buildInputsMapFromMeta, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { INDICATOR_MONITOR_TRIGGER_ID } from '@/lib/indicators/monitor-config'
import {
  mapMarketBarToBarMs,
  mapMarketSeriesToBarsMs,
  normalizeBarsMs,
} from '@/lib/indicators/series-data'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import type { BarMs, NormalizedPineSignal } from '@/lib/indicators/types'
import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { acquireLock, getRedisClient, getRedisStorageMode, releaseLock } from '@/lib/redis'
import { decryptSecret } from '@/lib/utils'
import { blockExistsInDeployment } from '@/lib/workflows/db-helpers'
import { executeWorkflowJob } from '@/background/workflow-execution'
import { executeProviderRequest } from '@/providers/market'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import type { MarketBar, MarketSeries } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { RateLimiter } from '@/services/queue'
import { marketStreamManager } from '@/socket-server/market/manager'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'

type MonitorRuntimeStatus = 'not_initialized' | 'running' | 'degraded' | 'disabled'

export type IndicatorMonitorRuntimeHealth = {
  enabled: boolean
  status: MonitorRuntimeStatus
  reconcileEndpointEnabled: boolean
  lock: {
    mode: 'fail_closed'
    redisConfigured: boolean
    redisClientAvailable: boolean
    degraded: boolean
  }
  stats: {
    activeSubscriptions: number
    lastReconcileAt: string | null
    lastReconcileError: string | null
    dispatchedCount: number
    skippedCount: number
  }
}

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

type IndicatorDefinition = {
  id: string
  name: string
  pineCode: string
  inputMeta?: Record<string, unknown>
}

type MonitorRuntimeConfig = {
  id: string
  path: string
  workflowId: string
  workspaceId: string
  userId: string
  pinnedApiKeyId: string | null
  blockId: string
  providerId: 'alpaca' | 'finnhub'
  interval: string
  intervalMs: number | null
  indicatorId: string
  listing: ListingIdentity
  providerParams?: Record<string, unknown>
  auth?: {
    encryptedSecrets?: Record<string, string>
  }
  signature: string
}

type IndicatorMonitorSubscription = {
  config: MonitorRuntimeConfig
  indicator: IndicatorDefinition
  inputsMap: Record<string, unknown>
  bars: BarMs[]
  stream: { close: () => void }
  symbol: string
  marketCode?: string
  timezone?: string
  startAt?: string
  endAt?: string
  lastDispatchedBarBucketMs: number | null
}

const logger = createLogger('IndicatorMonitorRuntime')
const indicatorMonitorDispatchIdempotency = new IdempotencyService({
  namespace: 'indicator-monitor',
})

const LOCK_KEY = 'indicator-monitor-runtime-lock'
const LOCK_EXPIRY_SECONDS = 60 * 60
const RECONCILE_INTERVAL_MS = 30_000
const MONITOR_WINDOW_BARS = 2000
const ENV_VAR_PATTERN = /\{\{([^}]+)\}\}/g
const DATABASE_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
])

function isDatabaseConnectionError(error: unknown): boolean {
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

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeSymbol = (value: string) => value.trim().toUpperCase()

const toMarketSeries = ({
  bars,
  listing,
  marketCode,
  timezone,
}: {
  bars: BarMs[]
  listing: ListingIdentity
  marketCode?: string
  timezone?: string
}): MarketSeries => {
  const listingBase = listing.listing_type === 'default' ? listing.listing_id : listing.base_id
  const listingQuote = listing.listing_type === 'default' ? undefined : listing.quote_id

  return {
    listing,
    listingBase,
    listingQuote,
    marketCode,
    timezone,
    start: bars[0] ? new Date(bars[0].openTime).toISOString() : undefined,
    end: bars[bars.length - 1] ? new Date(bars[bars.length - 1].openTime).toISOString() : undefined,
    bars: bars.map((bar) => ({
      timeStamp: new Date(bar.openTime).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
  }
}

const chooseCandidate = ({
  triggers,
  latestBarOpenTimeSec,
}: {
  triggers: NormalizedPineSignal[]
  latestBarOpenTimeSec: number | null
}): {
  candidate: NormalizedPineSignal | null
  reason: 'no_latest_candidate' | 'ok'
} => {
  if (latestBarOpenTimeSec === null) {
    return { candidate: null, reason: 'no_latest_candidate' }
  }

  const latestCandidates = triggers.filter((signal) => signal.time === latestBarOpenTimeSec)
  if (latestCandidates.length === 0) {
    return { candidate: null, reason: 'no_latest_candidate' }
  }

  const sorted = [...latestCandidates].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    if (a.event !== b.event) return a.event.localeCompare(b.event)
    return a.signal.localeCompare(b.signal)
  })

  return { candidate: sorted[0] ?? null, reason: 'ok' }
}

const normalizeProviderConfig = (
  row: typeof webhook.$inferSelect,
  workspaceId: string,
  userId: string,
  pinnedApiKeyId: string | null
): MonitorRuntimeConfig | null => {
  if (!isRecord(row.providerConfig)) return null

  const providerConfig = row.providerConfig
  const triggerId = toTrimmedString(providerConfig.triggerId)
  if (triggerId && triggerId !== INDICATOR_MONITOR_TRIGGER_ID) return null

  if (providerConfig.monitor !== undefined && !isRecord(providerConfig.monitor)) return null

  const monitor = isRecord(providerConfig.monitor) ? providerConfig.monitor : providerConfig
  const providerId = toTrimmedString(monitor.providerId)
  const interval = toTrimmedString(monitor.interval)
  const indicatorId = toTrimmedString(monitor.indicatorId)
  const listing = toListingValueObject(monitor.listing as any)
  const triggerBlockId =
    toTrimmedString(monitor.triggerBlockId) ??
    toTrimmedString(monitor.blockId) ??
    toTrimmedString(row.blockId)

  if (!providerId || (providerId !== 'alpaca' && providerId !== 'finnhub')) return null
  if (!interval || !indicatorId || !listing) return null
  if (!triggerBlockId) return null

  const intervalMs = resolveDispatchIntervalMs(interval)
  const providerParams = isRecord(monitor.providerParams)
    ? (monitor.providerParams as Record<string, unknown>)
    : undefined
  const auth = isRecord(monitor.auth)
    ? {
        encryptedSecrets: isRecord(monitor.auth.encryptedSecrets)
          ? (monitor.auth.encryptedSecrets as Record<string, string>)
          : undefined,
      }
    : undefined

  const normalized: Omit<MonitorRuntimeConfig, 'signature'> = {
    id: row.id,
    path: row.path,
    workflowId: row.workflowId,
    workspaceId,
    userId,
    pinnedApiKeyId,
    blockId: triggerBlockId,
    providerId,
    interval,
    intervalMs,
    indicatorId,
    listing,
    providerParams,
    auth,
  }

  return {
    ...normalized,
    signature: JSON.stringify({
      ...normalized,
      auth: normalized.auth ? { hasSecrets: Boolean(normalized.auth.encryptedSecrets) } : undefined,
    }),
  }
}

async function resolveMonitorAuth(
  monitor: MonitorRuntimeConfig
): Promise<{ apiKey?: string; apiSecret?: string }> {
  const encryptedSecrets = monitor.auth?.encryptedSecrets ?? {}
  const decryptedSecrets: Record<string, string> = {}
  let envVars: Record<string, string> | null = null
  const missingVars = new Set<string>()

  for (const [key, value] of Object.entries(encryptedSecrets)) {
    try {
      const result = await decryptSecret(value)
      const decrypted = result.decrypted?.trim()
      if (!decrypted) continue

      if (decrypted.includes('{{') && decrypted.includes('}}')) {
        if (!envVars) {
          envVars = await getEffectiveDecryptedEnv(monitor.userId, monitor.workspaceId)
        }

        const resolved = decrypted.replace(ENV_VAR_PATTERN, (_match, envKeyRaw) => {
          const envKey = String(envKeyRaw).trim()
          if (!envKey) return _match
          const envValue = envVars?.[envKey]
          if (envValue === undefined) {
            missingVars.add(envKey)
            return ''
          }
          return envValue
        })
        const trimmedResolved = resolved.trim()
        if (trimmedResolved) {
          decryptedSecrets[key] = trimmedResolved
        }
        continue
      }

      decryptedSecrets[key] = decrypted
    } catch (error) {
      logger.warn('Failed to decrypt monitor auth secret', {
        monitorId: monitor.id,
        field: key,
        error,
      })
    }
  }

  if (missingVars.size > 0) {
    throw new Error(
      `Missing environment variable${missingVars.size > 1 ? 's' : ''}: ${Array.from(missingVars).join(', ')}`
    )
  }

  return {
    apiKey: decryptedSecrets.apiKey || process.env.ALPACA_API_KEY_ID || process.env.FINNHUB_API_KEY,
    apiSecret: decryptedSecrets.apiSecret || process.env.ALPACA_API_SECRET_KEY,
  }
}

async function resolveIndicatorDefinitions(
  monitors: MonitorRuntimeConfig[]
): Promise<Map<string, IndicatorDefinition>> {
  const definitions = new Map<string, IndicatorDefinition>()

  monitors.forEach((monitor) => {
    const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(monitor.indicatorId)
    if (!defaultIndicator) return
    definitions.set(`${monitor.workspaceId}:${monitor.indicatorId}`, {
      id: monitor.indicatorId,
      name: defaultIndicator.name,
      pineCode: defaultIndicator.pineCode,
      inputMeta: defaultIndicator.inputMeta as Record<string, unknown> | undefined,
    })
  })

  const unresolvedCustoms = monitors.filter(
    (monitor) => !DEFAULT_INDICATOR_RUNTIME_MAP.has(monitor.indicatorId)
  )
  if (unresolvedCustoms.length === 0) return definitions

  const indicatorIds = Array.from(new Set(unresolvedCustoms.map((monitor) => monitor.indicatorId)))
  const workspaceIds = Array.from(new Set(unresolvedCustoms.map((monitor) => monitor.workspaceId)))

  const rows = await db
    .select({
      id: pineIndicators.id,
      workspaceId: pineIndicators.workspaceId,
      name: pineIndicators.name,
      pineCode: pineIndicators.pineCode,
      inputMeta: pineIndicators.inputMeta,
    })
    .from(pineIndicators)
    .where(
      and(
        inArray(pineIndicators.id, indicatorIds),
        inArray(pineIndicators.workspaceId, workspaceIds)
      )
    )

  rows.forEach((row) => {
    definitions.set(`${row.workspaceId}:${row.id}`, {
      id: row.id,
      name: row.name,
      pineCode: row.pineCode,
      inputMeta: (row.inputMeta as Record<string, unknown> | undefined) ?? undefined,
    })
  })

  return definitions
}

export class IndicatorMonitorRuntime {
  private readonly logger: LoggerLike
  private status: MonitorRuntimeStatus = 'not_initialized'
  private running = false
  private starting = false
  private lockHeld = false
  private instanceId = randomUUID()
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private isReconciling = false
  private pendingReconcile = false
  private lastReconcileAt: string | null = null
  private lastReconcileError: string | null = null
  private dispatchedCount = 0
  private skippedCount = 0
  private subscriptions = new Map<string, IndicatorMonitorSubscription>()

  constructor(loggerLike?: LoggerLike) {
    this.logger = loggerLike ?? logger
  }

  getHealth(): IndicatorMonitorRuntimeHealth {
    const redisConfigured = getRedisStorageMode() === 'redis'
    const redisClientAvailable = Boolean(getRedisClient())
    const degraded = this.status === 'degraded' || (redisConfigured && !redisClientAvailable)

    return {
      enabled: this.running,
      status: this.status,
      reconcileEndpointEnabled: true,
      lock: {
        mode: 'fail_closed',
        redisConfigured,
        redisClientAvailable,
        degraded,
      },
      stats: {
        activeSubscriptions: this.subscriptions.size,
        lastReconcileAt: this.lastReconcileAt,
        lastReconcileError: this.lastReconcileError,
        dispatchedCount: this.dispatchedCount,
        skippedCount: this.skippedCount,
      },
    }
  }

  private clearRetryTimer() {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private clearReconcileTimer() {
    if (!this.reconcileTimer) return
    clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
  }

  private stopSubscriptions() {
    const subscriptions = Array.from(this.subscriptions.values())
    subscriptions.forEach((subscription) => {
      try {
        subscription.stream.close()
      } catch {
        // no-op
      }
    })
    this.subscriptions.clear()
  }

  private async releaseLockIfHeld() {
    if (!this.lockHeld) return

    try {
      await releaseLock(LOCK_KEY, this.instanceId)
    } catch (error) {
      this.logger.warn('Failed to release indicator monitor runtime lock', { error })
    } finally {
      this.lockHeld = false
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.start()
    }, RECONCILE_INTERVAL_MS)
    this.retryTimer.unref?.()
  }

  private async enterDegradedState(
    reason: 'startup' | 'interval' | 'request',
    error: unknown,
    shouldLogWarning: boolean
  ) {
    this.lastReconcileError = error instanceof Error ? error.message : String(error)
    this.status = 'degraded'
    this.running = false
    this.pendingReconcile = false
    this.clearReconcileTimer()
    this.stopSubscriptions()
    await this.releaseLockIfHeld()
    this.scheduleRetry()

    if (shouldLogWarning) {
      this.logger.warn('Indicator monitor paused; database unavailable', {
        reason,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : error,
      })
    }
  }

  async start() {
    if (this.running || this.starting) return

    this.starting = true

    try {
      this.clearRetryTimer()

      let lockAcquired = false
      try {
        lockAcquired = await acquireLock(LOCK_KEY, this.instanceId, LOCK_EXPIRY_SECONDS)
      } catch (error) {
        this.logger.warn('Indicator monitor runtime lock acquisition error', { error })
      }

      if (!lockAcquired) {
        this.running = false
        this.lockHeld = false
        this.status = getRedisStorageMode() === 'redis' ? 'degraded' : 'disabled'
        this.logger.warn('Indicator monitor runtime disabled; lock acquisition failed.')
        this.scheduleRetry()
        return
      }

      this.lockHeld = true
      this.running = true
      this.status = 'running'
      this.clearReconcileTimer()

      await this.reconcile('startup')

      if (!this.running) {
        return
      }

      this.reconcileTimer = setInterval(() => {
        void this.reconcile('interval')
      }, RECONCILE_INTERVAL_MS)
      this.reconcileTimer.unref?.()
    } finally {
      this.starting = false
    }
  }

  async stop() {
    this.clearRetryTimer()
    this.clearReconcileTimer()
    this.stopSubscriptions()

    if (this.lockHeld) {
      await releaseLock(LOCK_KEY, this.instanceId)
      this.lockHeld = false
    }

    this.running = false
    this.starting = false
    this.status = 'not_initialized'
  }

  async requestReconcile() {
    if (!this.running) {
      await this.start()
      if (!this.running) return
    }
    await this.reconcile('request')
  }

  private async reconcile(reason: 'startup' | 'interval' | 'request') {
    if (!this.running) return

    if (this.isReconciling) {
      this.pendingReconcile = true
      return
    }

    this.isReconciling = true
    this.lastReconcileError = null

    try {
      const rows = await db
        .select({
          webhook,
          workflow: {
            id: workflow.id,
            userId: workflow.userId,
            workspaceId: workflow.workspaceId,
            pinnedApiKeyId: workflow.pinnedApiKeyId,
            isDeployed: workflow.isDeployed,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(and(eq(webhook.provider, 'indicator'), eq(webhook.isActive, true)))

      let skippedMissingWorkspace = 0
      let skippedInvalidConfig = 0
      let disconnectedInvalidWorkflow = 0
      const monitors: MonitorRuntimeConfig[] = []

      for (const row of rows) {
        if (!row.workflow.workspaceId) {
          skippedMissingWorkspace += 1
          await this.disconnectMonitor(row.webhook.id, 'missing_workspace')
          continue
        }

        if (!row.workflow.isDeployed) {
          disconnectedInvalidWorkflow += 1
          await this.disconnectMonitor(row.webhook.id, 'workflow_not_deployed', {
            workflowId: row.workflow.id,
          })
          continue
        }

        const normalized = normalizeProviderConfig(
          row.webhook,
          row.workflow.workspaceId,
          row.workflow.userId,
          row.workflow.pinnedApiKeyId
        )

        if (!normalized) {
          skippedInvalidConfig += 1
          await this.disconnectMonitor(row.webhook.id, 'invalid_monitor_config', {
            workflowId: row.workflow.id,
          })
          continue
        }

        monitors.push(normalized)
      }

      if (rows.length > 0 && monitors.length === 0) {
        this.logger.warn(
          'Indicator monitor reconcile found rows but no runtime-eligible monitors',
          {
            reason,
            totalRows: rows.length,
            skippedMissingWorkspace,
            skippedInvalidConfig,
            disconnectedInvalidWorkflow,
          }
        )
      }

      const indicatorDefinitions = await resolveIndicatorDefinitions(monitors)
      const nextMonitorIds = new Set(monitors.map((monitor) => monitor.id))

      Array.from(this.subscriptions.entries()).forEach(([monitorId, subscription]) => {
        if (!nextMonitorIds.has(monitorId)) {
          this.stopSubscription(subscription)
          this.subscriptions.delete(monitorId)
        }
      })

      for (const monitor of monitors) {
        const existing = this.subscriptions.get(monitor.id)
        const nextIndicator = indicatorDefinitions.get(
          `${monitor.workspaceId}:${monitor.indicatorId}`
        )
        if (!nextIndicator) {
          await this.disconnectMonitor(monitor.id, 'indicator_not_found', {
            monitorId: monitor.id,
            workspaceId: monitor.workspaceId,
            indicatorId: monitor.indicatorId,
          })
          this.skippedCount += 1
          continue
        }

        if (!isIndicatorTriggerCapable(nextIndicator.pineCode)) {
          await this.disconnectMonitor(monitor.id, 'indicator_not_trigger_capable', {
            monitorId: monitor.id,
            workspaceId: monitor.workspaceId,
            indicatorId: monitor.indicatorId,
          })
          this.skippedCount += 1
          continue
        }

        if (!(await blockExistsInDeployment(monitor.workflowId, monitor.blockId))) {
          await this.disconnectMonitor(monitor.id, 'missing_trigger_block', {
            monitorId: monitor.id,
            workflowId: monitor.workflowId,
            blockId: monitor.blockId,
          })
          this.skippedCount += 1
          continue
        }

        const actorUserId = await getApiKeyOwnerUserId(monitor.pinnedApiKeyId)
        if (!actorUserId) {
          await this.disconnectMonitor(monitor.id, 'missing_billing_actor', {
            monitorId: monitor.id,
            workflowId: monitor.workflowId,
          })
          this.skippedCount += 1
          continue
        }

        const usageCheck = await checkServerSideUsageLimits({
          userId: actorUserId,
          workflowId: monitor.workflowId,
          workspaceId: monitor.workspaceId,
        })
        if (usageCheck.isExceeded) {
          await this.disconnectMonitor(monitor.id, 'usage_limit_exceeded', {
            monitorId: monitor.id,
            workflowId: monitor.workflowId,
            currentUsage: usageCheck.currentUsage,
            limit: usageCheck.limit,
          })
          this.skippedCount += 1
          continue
        }

        if (existing && existing.config.signature === monitor.signature) {
          continue
        }

        if (existing) {
          this.stopSubscription(existing)
          this.subscriptions.delete(monitor.id)
        }

        try {
          const subscription = await this.createSubscription(monitor, nextIndicator)
          this.subscriptions.set(monitor.id, subscription)
        } catch (error) {
          this.logger.warn('Failed to start indicator monitor subscription', {
            monitorId: monitor.id,
            reason,
            error:
              error instanceof Error
                ? {
                    message: error.message,
                    stack: error.stack,
                  }
                : error,
          })
          this.skippedCount += 1
        }
      }

      this.lastReconcileAt = new Date().toISOString()
      this.logger.info('Indicator monitor reconcile completed', {
        reason,
        totalRows: rows.length,
        eligibleMonitors: monitors.length,
        activeSubscriptions: this.subscriptions.size,
      })
    } catch (error) {
      this.lastReconcileError = error instanceof Error ? error.message : String(error)

      if (isDatabaseConnectionError(error)) {
        await this.enterDegradedState(reason, error, this.subscriptions.size > 0)
        return
      }

      this.logger.error('Indicator monitor reconcile failed', {
        reason,
        error,
      })
    } finally {
      this.isReconciling = false
      if (this.pendingReconcile) {
        this.pendingReconcile = false
        void this.reconcile('request')
      }
    }
  }

  private async createSubscription(
    monitor: MonitorRuntimeConfig,
    indicator: IndicatorDefinition
  ): Promise<IndicatorMonitorSubscription> {
    const auth = await resolveMonitorAuth(monitor)
    const listingContext = await resolveListingContext(monitor.listing)
    const providerConfig =
      monitor.providerId === 'alpaca' ? alpacaProviderConfig : finnhubProviderConfig
    const symbol = normalizeSymbol(resolveProviderSymbol(providerConfig, listingContext))

    if (!symbol) {
      throw new Error('Unable to resolve provider symbol')
    }

    const inputMeta = normalizeInputMetaMap(indicator.inputMeta)
    const inputsMap = buildInputsMapFromMeta(inputMeta)

    const initialBars = await this.fetchMonitorBars(monitor, auth)
    const cappedBars = initialBars.slice(-MONITOR_WINDOW_BARS)

    const stream = await this.createManagedMarketStream(monitor, auth)

    return {
      config: monitor,
      indicator,
      inputsMap,
      bars: cappedBars,
      stream,
      symbol,
      marketCode: listingContext.marketCode,
      timezone: listingContext.timeZoneName ?? undefined,
      startAt: cappedBars[0] ? new Date(cappedBars[0].openTime).toISOString() : undefined,
      endAt: cappedBars[cappedBars.length - 1]
        ? new Date(cappedBars[cappedBars.length - 1].openTime).toISOString()
        : undefined,
      lastDispatchedBarBucketMs: null,
    }
  }

  private async createManagedMarketStream(
    monitor: MonitorRuntimeConfig,
    auth: { apiKey?: string; apiSecret?: string }
  ) {
    const syntheticSocket = {
      id: `indicator-monitor-runtime:${monitor.id}`,
      userId: monitor.userId,
      emit: (event: string, payload: any) => {
        if (event === 'market-bar') {
          const bar = payload?.bar as MarketBar | undefined
          if (!bar) return
          void this.handleIncomingBar(monitor.id, bar)
          return
        }

        if (event === 'market-error') {
          const message =
            typeof payload?.message === 'string' && payload.message.trim()
              ? payload.message
              : 'Market stream error'
          this.logger.warn(
            `${monitor.providerId === 'alpaca' ? 'Alpaca' : 'Finnhub'} monitor stream error`,
            {
              monitorId: monitor.id,
              message,
            }
          )
        }
      },
    } as unknown as AuthenticatedSocket

    await marketStreamManager.subscribe(syntheticSocket, {
      provider: monitor.providerId,
      workspaceId: monitor.workspaceId,
      listing: monitor.listing,
      channel: 'bars',
      interval: monitor.interval,
      providerParams: monitor.providerParams,
      auth:
        monitor.providerId === 'alpaca'
          ? {
              apiKey: auth.apiKey,
              apiSecret: auth.apiSecret,
            }
          : {
              apiKey: auth.apiKey,
            },
    })

    return {
      close: () => {
        marketStreamManager.removeSocket(syntheticSocket.id)
      },
    }
  }

  private async fetchMonitorBars(
    monitor: MonitorRuntimeConfig,
    auth: { apiKey?: string; apiSecret?: string }
  ): Promise<BarMs[]> {
    const result = await executeProviderRequest(monitor.providerId, {
      kind: 'series',
      listing: monitor.listing,
      interval: monitor.interval,
      auth,
      providerParams: {
        ...(monitor.providerParams ?? {}),
        allowEmpty: true,
      },
      windows: [{ mode: 'bars', barCount: MONITOR_WINDOW_BARS }],
    })

    const marketSeries = result as MarketSeries
    return normalizeBarsMs(
      mapMarketSeriesToBarsMs(marketSeries, monitor.intervalMs ?? undefined),
      monitor.intervalMs ?? undefined
    )
  }

  private stopSubscription(subscription: IndicatorMonitorSubscription) {
    try {
      subscription.stream.close()
    } catch {
      // no-op
    }
  }

  private async disconnectMonitor(
    monitorId: string,
    reason: string,
    metadata: Record<string, unknown> = {}
  ) {
    const subscription = this.subscriptions.get(monitorId)
    if (subscription) {
      this.stopSubscription(subscription)
      this.subscriptions.delete(monitorId)
    }

    await db
      .update(webhook)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(and(eq(webhook.id, monitorId), eq(webhook.provider, 'indicator')))

    this.logger.warn('Indicator monitor disconnected', {
      monitorId,
      reason,
      ...metadata,
    })
  }

  private async handleIncomingBar(monitorId: string, bar: MarketBar) {
    const subscription = this.subscriptions.get(monitorId)
    if (!subscription) return

    const mapped = mapMarketBarToBarMs(bar, subscription.config.intervalMs ?? undefined)
    if (!mapped) return

    const mergedBars = normalizeBarsMs(
      [...subscription.bars, mapped],
      subscription.config.intervalMs ?? undefined
    )
    const cappedBars = mergedBars.slice(-MONITOR_WINDOW_BARS)
    subscription.bars = cappedBars
    subscription.startAt = cappedBars[0]
      ? new Date(cappedBars[0].openTime).toISOString()
      : undefined
    subscription.endAt = cappedBars[cappedBars.length - 1]
      ? new Date(cappedBars[cappedBars.length - 1].openTime).toISOString()
      : undefined

    await this.computeAndDispatch(subscription)
  }

  private async computeAndDispatch(subscription: IndicatorMonitorSubscription) {
    const monitor = subscription.config

    try {
      const compiled = await executeCompiledIndicator({
        pineCode: subscription.indicator.pineCode,
        barsMs: subscription.bars,
        inputsMap: subscription.inputsMap,
        listing: monitor.listing,
        interval: monitor.interval,
        intervalMs: monitor.intervalMs,
        executionTimeoutMs: 15_000,
        userId: monitor.userId,
      })

      if (!compiled.output) return
      const latestBarOpenTimeSec = resolveLatestBarOpenTimeSec(subscription.bars)
      const candidate = chooseCandidate({
        triggers: compiled.output.triggers,
        latestBarOpenTimeSec,
      })

      if (!candidate.candidate) {
        return
      }

      const barBucketMs = candidate.candidate.time * 1000
      if (subscription.lastDispatchedBarBucketMs === barBucketMs) {
        this.skippedCount += 1
        return
      }

      const eventId = buildLiveIndicatorTriggerEventId({
        monitorId: monitor.id,
        indicatorId: monitor.indicatorId,
        barBucketMs,
      })

      const marketSeries = toMarketSeries({
        bars: subscription.bars,
        listing: monitor.listing,
        marketCode: subscription.marketCode,
        timezone: subscription.timezone,
      })

      const payload = buildIndicatorTriggerDispatchPayload({
        eventId,
        executionId: eventId,
        emittedAt: new Date().toISOString(),
        triggerSignal: candidate.candidate,
        indicatorId: monitor.indicatorId,
        indicatorName: subscription.indicator.name,
        output: compiled.output,
        inputsMap: subscription.inputsMap,
        interval: monitor.interval,
        intervalMs: monitor.intervalMs ?? undefined,
        marketSeries,
        monitor: {
          id: monitor.id,
          workflowId: monitor.workflowId,
          blockId: monitor.blockId,
          listing: monitor.listing,
          providerId: monitor.providerId,
          interval: monitor.interval,
          indicatorId: monitor.indicatorId,
        },
      })

      const budgetResult = applyIndicatorTriggerPayloadBudget(payload)
      if (budgetResult.skipped) {
        this.logger.warn('Indicator monitor dispatch skipped: payload too large', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
          originalSizeBytes: budgetResult.metadata.originalSizeBytes,
          finalSizeBytes: budgetResult.metadata.finalSizeBytes,
          retainedBars: budgetResult.metadata.retainedBars,
        })
        this.skippedCount += 1
        return
      }

      if (budgetResult.metadata.truncated) {
        this.logger.warn('Indicator monitor payload truncated', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
          originalSizeBytes: budgetResult.metadata.originalSizeBytes,
          finalSizeBytes: budgetResult.metadata.finalSizeBytes,
          retainedBars: budgetResult.metadata.retainedBars,
        })
      }

      const actorUserId = await getApiKeyOwnerUserId(monitor.pinnedApiKeyId)
      if (!actorUserId) {
        await this.disconnectMonitor(monitor.id, 'missing_billing_actor', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
        })
        this.skippedCount += 1
        return
      }

      let billingContext: Awaited<ReturnType<typeof resolveWorkflowBillingContext>>
      try {
        billingContext = await resolveWorkflowBillingContext({
          workflowId: monitor.workflowId,
          actorUserId,
        })
      } catch (error) {
        await this.disconnectMonitor(monitor.id, 'invalid_billing_context', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
          error: error instanceof Error ? error.message : String(error),
        })
        this.skippedCount += 1
        return
      }
      const billingScope = {
        scopeType: billingContext.scopeType,
        scopeId: billingContext.scopeId,
        organizationId:
          billingContext.scopeType === 'organization_member' ||
          billingContext.scopeType === 'organization'
            ? billingContext.billingOwner.type === 'organization'
              ? billingContext.billingOwner.organizationId
              : null
            : null,
        userId:
          billingContext.scopeType === 'organization_member'
            ? actorUserId
            : billingContext.scopeType === 'user'
              ? billingContext.billingUserId
              : null,
      }

      const rateLimiter = new RateLimiter()
      const rateLimitResult = await rateLimiter.checkRateLimitWithSubscription(
        billingContext.billingUserId,
        billingContext.subscription,
        'webhook',
        true,
        billingScope
      )
      if (!rateLimitResult.allowed) {
        this.skippedCount += 1
        return
      }

      const usageCheck = await checkServerSideUsageLimits({
        userId: actorUserId,
        workflowId: monitor.workflowId,
        workspaceId: monitor.workspaceId,
      })
      if (usageCheck.isExceeded) {
        await this.disconnectMonitor(monitor.id, 'usage_limit_exceeded', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
        })
        this.skippedCount += 1
        return
      }

      if (!(await blockExistsInDeployment(monitor.workflowId, monitor.blockId))) {
        await this.disconnectMonitor(monitor.id, 'missing_trigger_block', {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
          blockId: monitor.blockId,
        })
        this.skippedCount += 1
        return
      }

      const workflowPayload = {
        workflowId: monitor.workflowId,
        userId: actorUserId,
        input: budgetResult.payload,
        triggerType: 'webhook' as const,
        startBlockId: monitor.blockId,
        executionTarget: 'deployed' as const,
        triggerData: {
          source: 'indicator_trigger',
          executionTarget: 'deployed',
          monitor: {
            id: monitor.id,
            workflowId: monitor.workflowId,
            blockId: monitor.blockId,
            listing: monitor.listing,
            providerId: monitor.providerId,
            interval: monitor.interval,
            indicatorId: monitor.indicatorId,
          },
        },
        metadata: {
          triggerType: 'webhook',
          source: 'indicator_monitor',
          eventId,
          monitorId: monitor.id,
        },
      }

      await indicatorMonitorDispatchIdempotency.executeWithIdempotency(
        'workflow-execution',
        eventId,
        async () => {
          if (isTruthy(env.TRIGGER_DEV_ENABLED)) {
            return tasks.trigger('workflow-execution', workflowPayload)
          }

          return executeWorkflowJob(workflowPayload)
        },
        {
          monitorId: monitor.id,
          workflowId: monitor.workflowId,
        }
      )

      subscription.lastDispatchedBarBucketMs = barBucketMs
      this.dispatchedCount += 1
    } catch (error) {
      this.logger.warn('Indicator monitor compute/dispatch failed', {
        monitorId: monitor.id,
        workflowId: monitor.workflowId,
        error,
      })
      this.skippedCount += 1
    }
  }
}
