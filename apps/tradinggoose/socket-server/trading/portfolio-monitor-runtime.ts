import { randomUUID } from 'node:crypto'
import { db, webhook, workflow } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { evaluatePortfolioFireCondition } from '@/lib/monitors/portfolio-conditions'
import type { PortfolioMonitorProviderConfig } from '@/lib/monitors/portfolio-config'
import {
  isMonitorProviderConfigForProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import type { PortfolioMonitorExecutionPayload } from '@/background/portfolio-monitor-execution'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import {
  type TradingPortfolioDataPayload,
  tradingPortfolioStreamManager,
} from '@/socket-server/trading/portfolio-manager'

const logger = createLogger('PortfolioMonitorRuntime')

const RECONCILE_INTERVAL_MS = 30_000

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

type PortfolioMonitorRuntimeConfig = {
  id: string
  workflowId: string
  workspaceId: string
  userId: string
  pinnedApiKeyId: string | null
  blockId: string
  providerId: string
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioMonitorProviderConfig['monitor']['condition']
  fireMode: PortfolioMonitorProviderConfig['monitor']['fireMode']
  cooldownSeconds: number
  pollIntervalSeconds: number
  runtimeState?: PortfolioMonitorProviderConfig['runtimeState']
  signature: string
}

type PortfolioMonitorSubscription = {
  config: PortfolioMonitorRuntimeConfig
  unsubscribe: () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const toConfig = (
  row: typeof webhook.$inferSelect,
  workflowRow: {
    userId: string
    workspaceId: string | null
    pinnedApiKeyId: string | null
  }
): PortfolioMonitorRuntimeConfig | null => {
  if (!workflowRow.workspaceId || !isRecord(row.providerConfig)) return null
  if (!isMonitorProviderConfigForProvider(row.providerConfig, PORTFOLIO_MONITOR_PROVIDER)) {
    return null
  }
  const providerConfig = row.providerConfig as PortfolioMonitorProviderConfig
  const monitor = providerConfig.monitor

  const normalized: Omit<PortfolioMonitorRuntimeConfig, 'signature'> = {
    id: row.id,
    workflowId: row.workflowId,
    workspaceId: workflowRow.workspaceId,
    userId: workflowRow.userId,
    pinnedApiKeyId: workflowRow.pinnedApiKeyId,
    blockId: monitor.triggerBlockId,
    providerId: monitor.providerId,
    serviceId: monitor.serviceId,
    credentialId: monitor.credentialId,
    accountId: monitor.accountId,
    condition: monitor.condition,
    fireMode: monitor.fireMode,
    cooldownSeconds: monitor.cooldownSeconds,
    pollIntervalSeconds: monitor.pollIntervalSeconds,
    runtimeState: providerConfig.runtimeState,
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
  private running = false
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private subscriptions = new Map<string, PortfolioMonitorSubscription>()

  constructor(loggerLike?: LoggerLike) {
    this.logger = loggerLike ?? logger
  }

  getHealth() {
    return {
      enabled: this.running,
      stats: {
        activeSubscriptions: this.subscriptions.size,
      },
    }
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.reconcile('startup')
    this.reconcileTimer = setInterval(() => void this.reconcile('interval'), RECONCILE_INTERVAL_MS)
    this.reconcileTimer.unref?.()
  }

  stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = null
    }
    this.subscriptions.forEach((subscription) => subscription.unsubscribe())
    this.subscriptions.clear()
    this.running = false
  }

  async requestReconcile() {
    if (!this.running) await this.start()
    await this.reconcile('request')
  }

  private async reconcile(reason: 'startup' | 'interval' | 'request') {
    if (!this.running) return

    const rows = await db
      .select({
        webhook,
        workflow: {
          userId: workflow.userId,
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
        userId: config.userId,
        workspaceId: config.workspaceId,
        provider: config.providerId,
        serviceId: config.serviceId,
        portfolioIdentity: toPortfolioIdentity(config),
        channel: 'account-snapshot',
        pollIntervalSeconds: config.pollIntervalSeconds,
        clientSubscriptionId: `portfolio-monitor:${config.id}`,
        onData: (payload) => void this.handlePortfolioData(config.id, payload),
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
      activeSubscriptions: this.subscriptions.size,
    })
  }

  private async handlePortfolioData(monitorId: string, payload: TradingPortfolioDataPayload) {
    if (payload.channel !== 'account-snapshot') return
    const subscription = this.subscriptions.get(monitorId)
    if (!subscription) return

    const config = subscription.config
    const currentDetail = payload.portfolioDetail
    const previousDetail = config.runtimeState?.previousSnapshot as PortfolioDetail | undefined
    const previousWasTrue = config.runtimeState?.wasTrue
    const previousLastFiredAt = config.runtimeState?.lastFiredAt
    const conditionMatched = evaluatePortfolioFireCondition({
      condition: config.condition,
      current: currentDetail,
      previous: previousDetail,
    })
    const crossedEdge = conditionMatched && previousWasTrue !== true
    const shouldFire =
      conditionMatched &&
      (config.fireMode === 'while_true' || crossedEdge) &&
      isCooldownOpen(previousLastFiredAt, config.cooldownSeconds)
    const evaluatedAt = new Date().toISOString()
    const nextRuntimeState: PortfolioMonitorProviderConfig['runtimeState'] = {
      lastEvaluatedAt: evaluatedAt,
      lastFiredAt: shouldFire ? evaluatedAt : previousLastFiredAt,
      wasTrue: conditionMatched,
      previousSnapshot: currentDetail,
    }

    await this.updateRuntimeState(config.id, nextRuntimeState)
    config.runtimeState = nextRuntimeState

    if (!shouldFire) return

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
        userId: config.userId,
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
      await enqueuePendingExecution({
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
    } catch (error) {
      if (isPendingExecutionLimitError(error)) {
        this.logger.warn('Portfolio monitor queue backlog is full; skipping monitor event', {
          monitorId: config.id,
          pendingCount: error.details.pendingCount,
          maxPendingCount: error.details.maxPendingCount,
        })
        return
      }
      throw error
    }
  }

  private async updateRuntimeState(
    monitorId: string,
    runtimeState: PortfolioMonitorProviderConfig['runtimeState']
  ) {
    const [row] = await db
      .select({ providerConfig: webhook.providerConfig })
      .from(webhook)
      .where(and(eq(webhook.id, monitorId), eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER)))
      .limit(1)
    if (!row || !isRecord(row.providerConfig)) return

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...(row.providerConfig as Record<string, unknown>),
          runtimeState,
        },
        updatedAt: new Date(),
      })
      .where(and(eq(webhook.id, monitorId), eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER)))
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
