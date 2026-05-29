import { randomUUID } from 'node:crypto'
import { db, webhook, workflow } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { ExecutionGateError } from '@/lib/execution/execution-concurrency-limit'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import {
  evaluatePortfolioFireCondition,
  type PortfolioConditionSnapshot,
} from '@/lib/monitors/portfolio-conditions'
import {
  type PortfolioMonitorProviderConfig,
  PortfolioMonitorProviderConfigSchema,
} from '@/lib/monitors/portfolio-config'
import { PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import type { PortfolioMonitorExecutionPayload } from '@/background/portfolio-monitor-execution'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { getTradingProviderOAuthServiceId } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import {
  createMonitorRuntimeLock,
  getMonitorRuntimeUnavailableStatus,
  isMonitorRuntimeDatabaseConnectionError,
  type MonitorRuntimeLockHealth,
  type MonitorRuntimeStatus,
} from '@/socket-server/monitor-runtime-lock'
import {
  type TradingPortfolioDataPayload,
  tradingPortfolioStreamManager,
} from '@/socket-server/trading/portfolio-manager'

const logger = createLogger('PortfolioMonitorRuntime')

const LOCK_KEY = 'portfolio-monitor-runtime-lock'
const RECONCILE_INTERVAL_MS = 30_000

export type PortfolioMonitorRuntimeHealth = {
  enabled: boolean
  status: MonitorRuntimeStatus
  lock: MonitorRuntimeLockHealth
  stats: {
    activeSubscriptions: number
    lastReconcileAt: string | null
    lastReconcileError: string | null
  }
}

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

type PortfolioMonitorRuntimeConfig = {
  id: string
  workflowId: string
  workspaceId: string
  connectionOwnerUserId: string
  pinnedApiKeyId: string | null
  blockId: string
  providerId: TradingProviderId
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioMonitorProviderConfig['monitor']['condition']
  fireMode: PortfolioMonitorProviderConfig['monitor']['fireMode']
  cooldownSeconds: number
  pollIntervalSeconds: number
  runtimeState?: PortfolioMonitorProviderConfig['runtimeState']
  updatedAt: Date
  signature: string
}

type PortfolioMonitorSubscription = {
  config: PortfolioMonitorRuntimeConfig
  unsubscribe: () => void
}

const toConfig = (
  row: typeof webhook.$inferSelect,
  workflowRow: {
    workspaceId: string | null
    pinnedApiKeyId: string | null
  }
): PortfolioMonitorRuntimeConfig | null => {
  if (!workflowRow.workspaceId) return null
  const providerConfig = PortfolioMonitorProviderConfigSchema.safeParse(row.providerConfig)
  if (!providerConfig.success) return null

  const monitor = providerConfig.data.monitor
  const serviceId = getTradingProviderOAuthServiceId(monitor.providerId, monitor.serviceId)
  if (!serviceId) return null

  const normalized: Omit<PortfolioMonitorRuntimeConfig, 'signature'> = {
    id: row.id,
    workflowId: row.workflowId,
    workspaceId: workflowRow.workspaceId,
    connectionOwnerUserId: monitor.connectionOwnerUserId,
    pinnedApiKeyId: workflowRow.pinnedApiKeyId,
    blockId: monitor.triggerBlockId,
    providerId: monitor.providerId,
    serviceId,
    credentialId: monitor.credentialId,
    accountId: monitor.accountId,
    condition: monitor.condition,
    fireMode: monitor.fireMode,
    cooldownSeconds: monitor.cooldownSeconds,
    pollIntervalSeconds: monitor.pollIntervalSeconds,
    runtimeState: providerConfig.data.runtimeState,
    updatedAt: row.updatedAt,
  }

  return {
    ...normalized,
    signature: JSON.stringify({
      ...normalized,
      runtimeState: undefined,
    }),
  }
}

const toPortfolioIdentity = (config: PortfolioMonitorRuntimeConfig): PortfolioIdentity => ({
  providerId: config.providerId,
  credentialId: config.credentialId,
  serviceId: config.serviceId,
  accountId: config.accountId,
})

const isCooldownOpen = (lastFiredAt: string | undefined, cooldownSeconds: number) => {
  if (!lastFiredAt || cooldownSeconds <= 0) return true
  const lastFiredMs = Date.parse(lastFiredAt)
  if (!Number.isFinite(lastFiredMs)) return true
  return Date.now() - lastFiredMs >= cooldownSeconds * 1000
}

export class PortfolioMonitorRuntime {
  private readonly logger: LoggerLike
  private readonly runtimeLock: ReturnType<typeof createMonitorRuntimeLock>
  private status: MonitorRuntimeStatus = 'not_initialized'
  private running = false
  private starting = false
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private isReconciling = false
  private pendingReconcile = false
  private lastReconcileAt: string | null = null
  private lastReconcileError: string | null = null
  private subscriptions = new Map<string, PortfolioMonitorSubscription>()

  constructor(loggerLike?: LoggerLike) {
    this.logger = loggerLike ?? logger
    this.runtimeLock = createMonitorRuntimeLock({
      key: LOCK_KEY,
      label: 'Portfolio monitor',
      logger: this.logger,
      onLost: (error) => this.enterDegradedState('lock', error, true),
    })
  }

  getHealth(): PortfolioMonitorRuntimeHealth {
    return {
      enabled: this.running,
      status: this.status,
      lock: this.runtimeLock.getHealth(this.status),
      stats: {
        activeSubscriptions: this.subscriptions.size,
        lastReconcileAt: this.lastReconcileAt,
        lastReconcileError: this.lastReconcileError,
      },
    }
  }

  async start() {
    if (this.running || this.starting) return

    this.starting = true
    try {
      this.clearRetryTimer()

      if (!(await this.runtimeLock.acquire())) {
        this.running = false
        this.status = getMonitorRuntimeUnavailableStatus()
        this.logger.warn('Portfolio monitor runtime disabled; lock acquisition failed.')
        this.scheduleRetry()
        return
      }

      this.running = true
      this.status = 'running'
      this.runtimeLock.stopRenewal()
      this.clearReconcileTimer()
      this.runtimeLock.startRenewal()

      await this.reconcile('startup')

      if (!this.running) return
    } finally {
      this.starting = false
    }

    this.reconcileTimer = setInterval(() => void this.reconcile('interval'), RECONCILE_INTERVAL_MS)
    this.reconcileTimer.unref?.()
  }

  async stop() {
    this.clearRetryTimer()
    this.runtimeLock.stopRenewal()
    this.clearReconcileTimer()
    this.stopSubscriptions()
    await this.runtimeLock.release()
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
    this.subscriptions.forEach((subscription) => subscription.unsubscribe())
    this.subscriptions.clear()
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
    reason: 'startup' | 'interval' | 'request' | 'lock',
    error: unknown,
    shouldLogWarning: boolean
  ) {
    this.lastReconcileError = error instanceof Error ? error.message : String(error)
    this.status = 'degraded'
    this.running = false
    this.pendingReconcile = false
    this.runtimeLock.stopRenewal()
    this.clearReconcileTimer()
    this.stopSubscriptions()
    await this.runtimeLock.release()
    this.scheduleRetry()

    if (shouldLogWarning) {
      this.logger.warn('Portfolio monitor paused; runtime unavailable', {
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

  private async reconcile(reason: 'startup' | 'interval' | 'request') {
    if (!this.running) return

    if (this.isReconciling) {
      this.pendingReconcile = true
      return
    }

    this.isReconciling = true
    this.lastReconcileError = null

    try {
      await this.reconcileSubscriptions(reason)
    } catch (error) {
      this.lastReconcileError = error instanceof Error ? error.message : String(error)
      if (isMonitorRuntimeDatabaseConnectionError(error)) {
        await this.enterDegradedState(reason, error, this.subscriptions.size > 0)
        return
      }

      this.logger.error('Portfolio monitor reconcile failed', {
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

  private async reconcileSubscriptions(reason: 'startup' | 'interval' | 'request') {
    const rows = await db
      .select({
        webhook,
        workflow: {
          workspaceId: workflow.workspaceId,
          pinnedApiKeyId: workflow.pinnedApiKeyId,
          isDeployed: workflow.isDeployed,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER), eq(webhook.isActive, true)))

    const configs: PortfolioMonitorRuntimeConfig[] = []
    for (const row of rows) {
      if (!row.workflow.isDeployed) {
        await this.disconnect(row.webhook.id, 'workflow_not_deployed')
        continue
      }
      const config = toConfig(row.webhook, row.workflow)
      if (!config) {
        await this.disconnect(row.webhook.id, 'invalid_monitor_config')
        continue
      }
      configs.push(config)
    }

    const nextIds = new Set(configs.map((config) => config.id))
    this.subscriptions.forEach((subscription, monitorId) => {
      if (!nextIds.has(monitorId)) {
        subscription.unsubscribe()
        this.subscriptions.delete(monitorId)
      }
    })

    for (const config of configs) {
      const existing = this.subscriptions.get(config.id)
      if (existing?.config.signature === config.signature) continue
      if (existing) {
        existing.unsubscribe()
        this.subscriptions.delete(config.id)
      }

      const subscription = tradingPortfolioStreamManager.subscribeData({
        userId: config.connectionOwnerUserId,
        workspaceId: config.workspaceId,
        provider: config.providerId,
        serviceId: config.serviceId,
        portfolioIdentity: toPortfolioIdentity(config),
        channel: 'account-snapshot',
        pollIntervalSeconds: config.pollIntervalSeconds,
        clientSubscriptionId: `portfolio-monitor:${config.id}`,
        onData: (payload) =>
          void this.handlePortfolioData(config.id, payload).catch((error) => {
            if (isMonitorRuntimeDatabaseConnectionError(error)) {
              void this.enterDegradedState('request', error, true)
              return
            }
            this.logger.error('Portfolio monitor data handler failed', {
              monitorId: config.id,
              error,
            })
          }),
        onError: (error) => {
          this.logger.warn('Portfolio monitor data subscription failed', {
            monitorId: config.id,
            error,
          })
        },
      })
      this.subscriptions.set(config.id, {
        config,
        unsubscribe: subscription.unsubscribe,
      })
    }

    this.logger.info('Portfolio monitor reconcile completed', {
      reason,
      totalRows: rows.length,
      activeSubscriptions: this.subscriptions.size,
    })
    this.lastReconcileAt = new Date().toISOString()
  }

  private async handlePortfolioData(monitorId: string, payload: TradingPortfolioDataPayload) {
    if (payload.channel !== 'account-snapshot') return
    const subscription = this.subscriptions.get(monitorId)
    if (!subscription) return

    const config = subscription.config
    const currentDetail = payload.portfolioDetail
    const currentSnapshot: PortfolioConditionSnapshot = {
      summary: currentDetail.summary,
      positions: currentDetail.positions,
    }
    const previousSnapshot = config.runtimeState?.previousSnapshot as
      | PortfolioConditionSnapshot
      | undefined
    const previousWasTrue = config.runtimeState?.wasTrue
    const previousLastFiredAt = config.runtimeState?.lastFiredAt
    const conditionMatched = evaluatePortfolioFireCondition({
      condition: config.condition,
      current: currentSnapshot,
      previous: previousSnapshot,
    })
    const crossedEdge = conditionMatched && previousWasTrue !== true
    const shouldFire =
      conditionMatched &&
      (config.fireMode === 'while_true' || crossedEdge) &&
      isCooldownOpen(previousLastFiredAt, config.cooldownSeconds)
    const evaluatedAt = new Date().toISOString()
    const evaluatedState: PortfolioMonitorProviderConfig['runtimeState'] = {
      lastEvaluatedAt: evaluatedAt,
      lastFiredAt: previousLastFiredAt,
      wasTrue: conditionMatched,
      previousSnapshot: currentSnapshot,
    }

    if (!shouldFire) {
      if (await this.updateRuntimeState(config, evaluatedState)) {
        config.runtimeState = evaluatedState
      }
      return
    }

    if (!(await this.getCurrentProviderConfig(config))) return

    const actorUserId = await getApiKeyOwnerUserId(config.pinnedApiKeyId)
    if (!actorUserId) {
      await this.disconnect(config.id, 'missing_billing_actor')
      return
    }

    const pendingExecutionId = `monitor:${config.id}:${randomUUID()}`
    const executionPayload: PortfolioMonitorExecutionPayload = {
      source: PORTFOLIO_MONITOR_PROVIDER,
      monitor: {
        id: config.id,
        workflowId: config.workflowId,
        workspaceId: config.workspaceId,
        actorUserId,
        blockId: config.blockId,
        providerId: config.providerId,
        serviceId: config.serviceId,
        credentialId: config.credentialId,
        accountId: config.accountId,
        condition: config.condition,
      },
      portfolioIdentity: payload.portfolioIdentity,
      portfolioDetail: currentDetail,
    }

    try {
      const handle = await enqueuePendingExecution({
        executionType: 'monitor',
        pendingExecutionId,
        workflowId: config.workflowId,
        workspaceId: config.workspaceId,
        userId: actorUserId,
        source: 'monitor:portfolio',
        orderingKey: `monitor:${config.id}`,
        requestId: pendingExecutionId,
        payload: executionPayload as unknown as Record<string, unknown>,
      })
      if (!handle.inserted) return
    } catch (error) {
      if (error instanceof ExecutionGateError) {
        await this.disconnect(config.id, 'invalid_billing_context')
        return
      }

      if (error instanceof TriggerExecutionUnavailableError) {
        await this.disconnect(config.id, 'trigger_execution_disabled')
        return
      }

      if (isPendingExecutionLimitError(error)) {
        this.logger.warn(
          'Portfolio monitor queue backlog is full; retaining monitor edge for retry',
          {
            monitorId: config.id,
            pendingCount: error.details.pendingCount,
            maxPendingCount: error.details.maxPendingCount,
          }
        )
        return
      }
      throw error
    }

    const firedState = {
      ...evaluatedState,
      lastFiredAt: evaluatedAt,
    }
    if (await this.updateRuntimeState(config, firedState)) {
      config.runtimeState = firedState
    }
  }

  private async getCurrentProviderConfig(config: PortfolioMonitorRuntimeConfig) {
    const [row] = await db
      .select({
        webhook,
        workflow: {
          workspaceId: workflow.workspaceId,
          pinnedApiKeyId: workflow.pinnedApiKeyId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(
        and(
          eq(webhook.id, config.id),
          eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER),
          eq(webhook.isActive, true),
          eq(workflow.isDeployed, true)
        )
      )
      .limit(1)
    if (!row) return null
    const currentConfig = toConfig(row.webhook, row.workflow)
    if (currentConfig?.signature !== config.signature) return null
    return row.webhook.providerConfig as Record<string, unknown>
  }

  private async updateRuntimeState(
    config: PortfolioMonitorRuntimeConfig,
    runtimeState: PortfolioMonitorProviderConfig['runtimeState']
  ) {
    const currentProviderConfig = await this.getCurrentProviderConfig(config)
    if (!currentProviderConfig) return false

    const providerConfig = {
      ...currentProviderConfig,
      runtimeState,
    }
    const updated = await db
      .update(webhook)
      .set({ providerConfig })
      .where(
        and(
          eq(webhook.id, config.id),
          eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER),
          eq(webhook.updatedAt, config.updatedAt)
        )
      )
      .returning({ id: webhook.id })
    return updated.length > 0
  }

  private async disconnect(monitorId: string, reason: string) {
    const subscription = this.subscriptions.get(monitorId)
    if (subscription) {
      subscription.unsubscribe()
      this.subscriptions.delete(monitorId)
    }
    await db
      .update(webhook)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(webhook.id, monitorId), eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER)))
    this.logger.warn('Portfolio monitor disconnected', { monitorId, reason })
  }
}
