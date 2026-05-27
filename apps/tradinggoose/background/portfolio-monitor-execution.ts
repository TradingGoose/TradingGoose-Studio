import { db, webhook } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console/logger'
import {
  evaluatePortfolioFireCondition,
  type PortfolioFireCondition,
} from '@/lib/monitors/portfolio-conditions'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
} from '@/lib/workflows/execution-runner'
import type { PortfolioDetail, PortfolioIdentity } from '@/providers/trading/portfolio-identity'

const logger = createLogger('PortfolioMonitorExecution')

type PortfolioMonitorExecutionMonitor = {
  id: string
  workflowId: string
  workspaceId: string
  userId: string
  actorUserId: string
  blockId: string
  providerId: string
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioFireCondition
  fireMode: 'edge' | 'while_true'
  cooldownSeconds: number
}

export type PortfolioMonitorExecutionPayload = {
  executionId?: string
  source: 'portfolio'
  monitor: PortfolioMonitorExecutionMonitor
  portfolioIdentity: PortfolioIdentity
  portfolioDetail: PortfolioDetail
  previousPortfolioDetail?: PortfolioDetail | null
  previousWasTrue?: boolean
  lastFiredAt?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export function isPortfolioMonitorExecutionPayload(
  value: unknown
): value is PortfolioMonitorExecutionPayload {
  if (!isRecord(value)) return false
  const monitor = value.monitor
  return (
    value.source === 'portfolio' &&
    isRecord(monitor) &&
    typeof monitor.id === 'string' &&
    typeof monitor.workflowId === 'string' &&
    typeof monitor.workspaceId === 'string' &&
    typeof monitor.actorUserId === 'string' &&
    typeof monitor.blockId === 'string' &&
    isRecord(value.portfolioIdentity) &&
    isRecord(value.portfolioDetail)
  )
}

async function disableMonitor(
  monitorId: string,
  reason: string,
  metadata: Record<string, unknown> = {}
) {
  await db
    .update(webhook)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(and(eq(webhook.id, monitorId), eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER)))

  logger.warn('Portfolio monitor disabled', {
    monitorId,
    reason,
    ...metadata,
  })
}

const isCooldownOpen = (lastFiredAt: string | null | undefined, cooldownSeconds: number) => {
  if (!lastFiredAt || cooldownSeconds <= 0) return true
  const lastFiredMs = Date.parse(lastFiredAt)
  if (!Number.isFinite(lastFiredMs)) return true
  return Date.now() - lastFiredMs >= cooldownSeconds * 1000
}

export async function executePortfolioMonitorJob(payload: PortfolioMonitorExecutionPayload) {
  const requestId = (payload.executionId ?? payload.monitor.id).slice(0, 8)
  const conditionMatched = evaluatePortfolioFireCondition({
    condition: payload.monitor.condition,
    current: payload.portfolioDetail,
    previous: payload.previousPortfolioDetail,
  })
  const crossedEdge = conditionMatched && payload.previousWasTrue !== true
  const shouldFire =
    conditionMatched &&
    (payload.monitor.fireMode === 'while_true' || crossedEdge) &&
    isCooldownOpen(payload.lastFiredAt, payload.monitor.cooldownSeconds)

  if (!shouldFire) {
    return {
      success: true,
      skipped: conditionMatched ? 'condition_already_true' : 'condition_false',
    }
  }

  const usageCheck = await checkServerSideUsageLimits({
    userId: payload.monitor.actorUserId,
    workflowId: payload.monitor.workflowId,
    workspaceId: payload.monitor.workspaceId,
  })
  if (usageCheck.isExceeded) {
    await disableMonitor(payload.monitor.id, 'usage_limit_exceeded', {
      workflowId: payload.monitor.workflowId,
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
    return { success: true, skipped: 'usage_limit_exceeded' as const }
  }

  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: payload.monitor.workflowId,
    executionTarget: 'deployed',
    workflowContext: { workspaceId: payload.monitor.workspaceId },
  })
  const blocks = blueprint.workflowData.blocks as Record<string, unknown>
  if (!blocks[payload.monitor.blockId]) {
    await disableMonitor(payload.monitor.id, 'missing_trigger_block', {
      workflowId: payload.monitor.workflowId,
      blockId: payload.monitor.blockId,
    })
    return { success: true, skipped: 'missing_trigger_block' as const }
  }

  const eventId = `portfolio_state:${payload.monitor.id}:${Date.now()}`
  const workflowInput = {
    input: `Portfolio state condition matched for ${payload.portfolioIdentity.accountName ?? payload.portfolioIdentity.accountId}`,
    event: 'portfolio_state_condition_matched',
    portfolio: {
      identity: payload.portfolioIdentity,
      detail: payload.portfolioDetail,
    },
    monitor: {
      id: payload.monitor.id,
      workflowId: payload.monitor.workflowId,
      blockId: payload.monitor.blockId,
      providerId: payload.monitor.providerId,
      serviceId: payload.monitor.serviceId,
      accountId: payload.monitor.accountId,
    },
    condition: payload.monitor.condition,
  }

  const { result } = await runPreparedWorkflowExecution({
    blueprint,
    actorUserId: payload.monitor.actorUserId,
    requestId,
    executionId: eventId,
    triggerType: 'webhook',
    workflowInput,
    start: {
      kind: 'block',
      blockId: payload.monitor.blockId,
    },
    triggerData: {
      source: PORTFOLIO_MONITOR_TRIGGER_ID,
      executionTarget: 'deployed',
      monitor: {
        id: payload.monitor.id,
        workflowId: payload.monitor.workflowId,
        blockId: payload.monitor.blockId,
        providerId: payload.monitor.providerId,
        serviceId: payload.monitor.serviceId,
        accountId: payload.monitor.accountId,
      },
    },
  })

  return {
    success: result.success,
    workflowId: payload.monitor.workflowId,
    executionId: eventId,
    output: result.output,
    error: result.error,
    executedAt: new Date().toISOString(),
    provider: PORTFOLIO_MONITOR_PROVIDER,
  }
}
