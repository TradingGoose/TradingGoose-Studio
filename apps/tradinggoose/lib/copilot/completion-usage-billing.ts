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
import { calculateCost } from '@/providers/ai/utils'

const BILLING_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30
const DEFAULT_ESTIMATED_RESERVATION_USD = 1
const logger = createLogger('CopilotUsageAPI')

const CompletionUsageReportSchema = z.object({
  kind: z.literal('completion'),
  model: z.string().min(1, 'model is required'),
  usage: z.unknown(),
  remoteModel: z.string().nullable().optional(),
  completionId: z.string().min(1, 'completionId is required'),
  workflowId: z.string().nullable().optional(),
})

interface TokenMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

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
      reason: 'billing_disabled' | 'no_token_metrics' | 'zero_cost' | 'ledger_not_found'
    }

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function pickNumber(source: any, keys: string[]): number | undefined {
  if (!source || typeof source !== 'object') return undefined
  for (const key of keys) {
    const candidate = readNumber(source[key])
    if (candidate !== undefined) {
      return candidate
    }
  }
  return undefined
}

function extractTokenMetrics(usage: any): TokenMetrics | null {
  const sources = [usage, usage?.tokenUsage, usage?.tokens, usage?.usageDetails]

  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let totalTokens: number | undefined

  for (const src of sources) {
    if (promptTokens === undefined) {
      promptTokens = pickNumber(src, [
        'prompt_tokens',
        'promptTokens',
        'input_tokens',
        'inputTokens',
        'prompt',
      ])
    }
    if (completionTokens === undefined) {
      completionTokens = pickNumber(src, [
        'completion_tokens',
        'completionTokens',
        'output_tokens',
        'outputTokens',
        'completion',
      ])
    }
    if (totalTokens === undefined) {
      totalTokens = pickNumber(src, [
        'total_tokens',
        'totalTokens',
        'tokens',
        'token_count',
        'total',
      ])
    }
  }

  if (totalTokens === undefined) {
    totalTokens = readNumber(usage?.tokensUsed) ?? readNumber(usage?.usage)
  }

  if (completionTokens === undefined) {
    completionTokens = 0
  }

  if (totalTokens !== undefined && promptTokens === undefined) {
    promptTokens = totalTokens - completionTokens
  }

  if (promptTokens === undefined || totalTokens === undefined) {
    return null
  }

  const normalizedPrompt = Math.max(0, Math.round(promptTokens))
  const normalizedCompletion = Math.max(0, Math.round(completionTokens ?? 0))
  const normalizedTotal = Math.max(
    0,
    Math.round(totalTokens ?? normalizedPrompt + normalizedCompletion)
  )

  if (normalizedTotal <= 0 || (normalizedPrompt === 0 && normalizedCompletion === 0)) {
    return null
  }

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: normalizedTotal,
  }
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

async function calculateCopilotCostUsd(params: {
  userId: string
  workflowId?: string
  billingModel: string
  promptTokens: number
  completionTokens: number
  fallbackUsd?: number
}): Promise<{
  costUsd: number
  normalizedModel: string
  billingContext: Awaited<ReturnType<typeof resolveWorkflowBillingContext>> | null
}> {
  const normalizedModel = params.billingModel.trim().toLowerCase()
  const costResult = calculateCost(
    normalizedModel,
    params.promptTokens,
    params.completionTokens,
    false
  )
  const { effectiveTier, billingContext } = await resolveEffectiveCopilotTier({
    userId: params.userId,
    workflowId: params.workflowId,
  })
  const rawCostUsd = Number(costResult.total || 0) * getTierCopilotCostMultiplier(effectiveTier)

  return {
    costUsd: rawCostUsd > 0 ? rawCostUsd : (params.fallbackUsd ?? 0),
    normalizedModel,
    billingContext,
  }
}

export async function calculateCopilotReservationUsdFromEstimate(params: {
  userId: string
  workflowId?: string
  model: string
  estimatedPromptTokens: number
  reservedCompletionTokens: number
}): Promise<number> {
  const { costUsd } = await calculateCopilotCostUsd({
    userId: params.userId,
    workflowId: params.workflowId,
    billingModel: params.model,
    promptTokens: params.estimatedPromptTokens,
    completionTokens: params.reservedCompletionTokens,
    fallbackUsd: DEFAULT_ESTIMATED_RESERVATION_USD,
  })

  return costUsd
}

export async function recordCopilotCompletionUsage(params: {
  userId: string
  workflowId?: string
  usage: any
  billingModel: string
  billingKeyId?: string | null
}): Promise<UsageBillingResult> {
  const metrics = extractTokenMetrics(params.usage)
  if (!metrics) {
    logger.info('Skipping copilot billing - no token metrics available', {
      billingKeyPrefix: 'copilot-completion-billing',
      billingKeyId: params.billingKeyId,
      reason: 'copilot_completion_usage',
    })
    return { billed: false, reason: 'no_token_metrics' }
  }

  const billingKey = params.billingKeyId
    ? `copilot-completion-billing:${params.billingKeyId}`
    : null
  if (billingKey && (await hasProcessedMessage(billingKey))) {
    logger.info('Copilot billing already processed', {
      billingKey,
      reason: 'copilot_completion_usage',
    })
    return { billed: false, duplicate: true }
  }

  const {
    costUsd: costToAdd,
    normalizedModel,
    billingContext,
  } = await calculateCopilotCostUsd({
    userId: params.userId,
    workflowId: params.workflowId,
    billingModel: params.billingModel,
    promptTokens: metrics.promptTokens,
    completionTokens: metrics.completionTokens,
  })
  if (costToAdd <= 0) {
    logger.info('Skipping copilot billing - calculated cost is zero', {
      userId: params.userId,
      workflowId: params.workflowId,
      billingKeyId: params.billingKeyId,
      model: normalizedModel,
      reason: 'copilot_completion_usage',
    })
    return { billed: false, reason: 'zero_cost' }
  }

  const extraUpdates: Record<string, any> = {
    totalCopilotCost: sql`total_copilot_cost + ${costToAdd}`,
    currentPeriodCopilotCost: sql`current_period_copilot_cost + ${costToAdd}`,
    totalCopilotCalls: sql`total_copilot_calls + 1`,
  }

  if (metrics.totalTokens > 0) {
    extraUpdates.totalCopilotTokens = sql`total_copilot_tokens + ${metrics.totalTokens}`
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

  if (billingKey) {
    await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)
  }

  logger.info('Copilot billing recorded', {
    userId: params.userId,
    billingUserId: billingContext?.billingUserId ?? params.userId,
    workflowId: params.workflowId,
    billingKeyId: params.billingKeyId,
    cost: costToAdd,
    tokens: metrics.totalTokens,
    model: normalizedModel,
    reason: 'copilot_completion_usage',
  })

  return {
    billed: true,
    duplicate: false,
    cost: costToAdd,
    tokens: metrics.totalTokens,
    model: normalizedModel,
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
            billingModel: payload.model,
            billingKeyId: payload.completionId,
          }),
      })

      if (!billing.billed && !billing.duplicate && billing.reason !== 'zero_cost') {
        logger.warn('Local Copilot completion usage mirror skipped', { reason: billing.reason })
      }
    } catch (error) {
      logger.warn('Failed to mirror local Copilot completion usage report', { error })
    }
  }
}
