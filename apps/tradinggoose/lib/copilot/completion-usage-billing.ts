import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierCopilotCostMultiplier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import { commitCopilotUsageReservation } from '@/lib/copilot/usage-reservations'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'

const BILLING_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30
const logger = createLogger('CopilotUsageAPI')

const CompletionUsageReportSchema = z.object({
  kind: z.literal('completion'),
  model: z.string().min(1, 'model is required'),
  usage: z.unknown(),
  completionId: z.string().min(1, 'completionId is required'),
  workflowId: z.string().nullable().optional(),
})

export type UsageBillingResult =
  | {
      billed: true
      duplicate: false
      cost: number
      tokens: number
      model: string
    }
  | {
      billed: false
      duplicate: true
    }
  | {
      billed: false
      duplicate?: false
      reason: 'ledger_not_found'
    }

function readOpenRouterTotalTokens(usage: unknown): number {
  const totalTokens =
    usage && typeof usage === 'object' ? (usage as Record<string, unknown>).total_tokens : undefined
  return typeof totalTokens === 'number' && Number.isFinite(totalTokens) && totalTokens > 0
    ? Math.round(totalTokens)
    : 0
}

async function resolveEffectiveCopilotTier(params: {
  userId: string
  workflowId?: string
}): Promise<{
  effectiveTier: any
  billingContext: Awaited<ReturnType<typeof resolveWorkflowBillingContext>> | null
}> {
  const billingContext = params.workflowId
    ? await resolveWorkflowBillingContext({
        workflowId: params.workflowId,
        actorUserId: params.userId,
      })
    : null
  const effectiveTier = params.workflowId
    ? (billingContext?.subscription?.tier ?? null)
    : ((await getPersonalEffectiveSubscription(params.userId))?.tier ?? null)

  if (!effectiveTier) {
    throw new Error(
      params.workflowId
        ? `No active workflow subscription tier found for billed copilot usage on workflow ${params.workflowId}`
        : `No active personal subscription tier found for billed copilot usage for user ${params.userId}`
    )
  }

  return {
    effectiveTier,
    billingContext,
  }
}

function readOpenRouterUsageCost(usage: unknown): number {
  const cost =
    usage && typeof usage === 'object' ? (usage as Record<string, unknown>).cost : undefined
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    throw new Error('OpenRouter usage.cost must be a finite, non-negative number')
  }
  return cost
}

export async function recordCopilotCompletionUsage(params: {
  userId: string
  workflowId?: string
  usage: unknown
  model: string
  billingKeyId: string
}): Promise<UsageBillingResult> {
  const openRouterCostUsd = readOpenRouterUsageCost(params.usage)
  const billingKey = `copilot-completion-billing:${params.billingKeyId}`
  if (await hasProcessedMessage(billingKey)) {
    logger.info('Copilot billing already processed', {
      billingKey,
      reason: 'copilot_completion_usage',
    })
    return { billed: false, duplicate: true }
  }

  const totalTokens = readOpenRouterTotalTokens(params.usage)
  const model = params.model
  const { effectiveTier, billingContext } = await resolveEffectiveCopilotTier({
    userId: params.userId,
    workflowId: params.workflowId,
  })
  const costToAdd = openRouterCostUsd * getTierCopilotCostMultiplier(effectiveTier)
  if (costToAdd === 0) {
    await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)
    logger.info('Copilot billing settled with an explicit zero provider cost', {
      userId: params.userId,
      workflowId: params.workflowId,
      billingKeyId: params.billingKeyId,
      model,
      reason: 'copilot_completion_usage',
    })
    return {
      billed: true,
      duplicate: false,
      cost: 0,
      tokens: totalTokens,
      model,
    }
  }

  const extraUpdates: Record<string, any> = {
    totalCopilotCost: sql`total_copilot_cost + ${costToAdd}`,
    currentPeriodCopilotCost: sql`current_period_copilot_cost + ${costToAdd}`,
    totalCopilotCalls: sql`total_copilot_calls + 1`,
  }

  if (totalTokens > 0) {
    extraUpdates.totalCopilotTokens = sql`total_copilot_tokens + ${totalTokens}`
  }

  const didAccrue = await accrueUserUsageCost({
    userId: params.userId,
    workflowId: params.workflowId,
    cost: costToAdd,
    extraUpdates,
    reason: 'copilot_completion_usage',
  })

  if (!didAccrue) {
    logger.warn('Copilot billing skipped - ledger record not found', {
      userId: params.userId,
      workflowId: params.workflowId,
      billingKeyId: params.billingKeyId,
      reason: 'copilot_completion_usage',
    })
    return { billed: false, reason: 'ledger_not_found' }
  }

  await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)

  logger.info('Copilot billing recorded', {
    userId: params.userId,
    billingUserId: billingContext?.billingUserId ?? params.userId,
    workflowId: params.workflowId,
    billingKeyId: params.billingKeyId,
    cost: costToAdd,
    tokens: totalTokens,
    model,
    reason: 'copilot_completion_usage',
  })

  return {
    billed: true,
    duplicate: false,
    cost: costToAdd,
    tokens: totalTokens,
    model,
  }
}

export async function mirrorLocalCopilotCompletionUsageReports(params: {
  userId: string
  reports: unknown[]
}): Promise<void> {
  if (isHosted || params.reports.length === 0) {
    return
  }

  if (!(await isBillingEnabledForRuntime())) {
    return
  }

  for (const report of params.reports) {
    try {
      const payload = CompletionUsageReportSchema.parse(report)
      const billing = await commitCopilotUsageReservation({
        userId: params.userId,
        workflowId: payload.workflowId ?? undefined,
        operation: () =>
          recordCopilotCompletionUsage({
            userId: params.userId,
            workflowId: payload.workflowId ?? undefined,
            usage: payload.usage,
            model: payload.model,
            billingKeyId: payload.completionId,
          }),
      })

      if (!billing.billed && !billing.duplicate) {
        logger.warn('Local Copilot completion usage mirror skipped', { reason: billing.reason })
      }
    } catch (error) {
      logger.warn('Failed to mirror local Copilot completion usage report', { error })
    }
  }
}
