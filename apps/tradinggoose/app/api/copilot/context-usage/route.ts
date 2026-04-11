import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierCopilotCostMultiplier, requireDefaultBillingTier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { COPILOT_RUNTIME_PROVIDER_IDS } from '@/lib/copilot/runtime-provider'
import { buildCopilotRuntimeProviderConfig } from '@/lib/copilot/runtime-provider.server'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { getCopilotApiUrl, proxyCopilotRequest } from '@/app/api/copilot/proxy'
import { calculateCost } from '@/providers/ai/utils'

const MODEL_SYNONYMS: Record<string, string> = {
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'claude-4.6-sonnet': 'claude-sonnet-4-6',
  'claude-opus-4.6': 'claude-opus-4-6',
  'claude-4.6-opus': 'claude-opus-4-6',
}

const logger = createLogger('ContextUsageAPI')

const ContextUsageRequestSchema = z.object({
  conversationId: z.string(),
  model: z.enum(COPILOT_RUNTIME_MODELS),
  // Generic copilot context usage is keyed by conversationId; workflowId is
  // optional supplemental view context only.
  workflowId: z.string().optional(),
  provider: z.enum(COPILOT_RUNTIME_PROVIDER_IDS).optional(),
  bill: z.boolean().optional(),
  assistantMessageId: z.string().optional(),
  billingModel: z.string().optional(),
  userId: z.string().optional(),
})

/**
 * POST /api/copilot/context-usage
 * Fetch context usage from copilot API
 */
export async function POST(req: NextRequest) {
  try {
    logger.info('[Context Usage API] Request received')

    const text = await req.text()
    if (!text) {
      logger.warn('[Context Usage API] Empty request body')
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
    }

    let body
    try {
      body = JSON.parse(text)
    } catch (e) {
      logger.warn('[Context Usage API] Invalid JSON body', { text })
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    logger.info('[Context Usage API] Request body', body)

    const parsed = ContextUsageRequestSchema.safeParse(body)

    if (!parsed.success) {
      logger.warn('[Context Usage API] Invalid request body', parsed.error.errors)
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.errors },
        { status: 400 }
      )
    }

    const { conversationId, model, workflowId, provider, bill, assistantMessageId, billingModel } =
      parsed.data
    const internalAuth = checkInternalApiKey(req)
    const session = !internalAuth.success ? await getSession() : null

    const userId = internalAuth.success ? parsed.data.userId : session?.user?.id
    if (!userId) {
      logger.warn('[Context Usage API] No session/user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const billingContext = workflowId
      ? await resolveWorkflowBillingContext({
          workflowId,
          actorUserId: userId,
        })
      : null
    const [subscription, defaultTier] = await Promise.all([
      billingContext
        ? Promise.resolve(billingContext.subscription)
        : getPersonalEffectiveSubscription(userId),
      requireDefaultBillingTier(),
    ])
    const effectiveTier = billingContext?.tier ?? subscription?.tier ?? defaultTier

    logger.info('[Context Usage API] Request validated', {
      conversationId,
      model,
      userId,
      workflowId,
      bill,
      assistantMessageId,
    })

    const { providerConfig } = buildCopilotRuntimeProviderConfig({
      model,
      provider,
    })

    // Call copilot API
    const requestPayload = {
      conversationId,
      model,
      userId,
      ...(workflowId ? { workflowId } : {}),
      provider: providerConfig,
    }

    logger.info('[Context Usage API] Calling copilot', {
      url: getCopilotApiUrl('/api/get-context-usage'),
      payload: requestPayload,
    })

    const simAgentResponse = await proxyCopilotRequest({
      endpoint: '/api/get-context-usage',
      body: requestPayload,
    })

    logger.info('[Context Usage API] Copilot response', {
      status: simAgentResponse.status,
      ok: simAgentResponse.ok,
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text().catch(() => '')
      logger.warn('[Context Usage API] TradingGoose agent request failed', {
        status: simAgentResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { error: 'Failed to fetch context usage from copilot' },
        { status: simAgentResponse.status }
      )
    }

    const data = await simAgentResponse.json()
    logger.info('[Context Usage API] Copilot data received', data)

    if (bill && assistantMessageId && (await isBillingEnabledForRuntime())) {
      try {
        await billCopilotUsage({
          userId,
          workflowId,
          assistantMessageId,
          usage: data,
          billingModel: billingModel || model,
          remoteModel: data?.model,
        })
      } catch (billingError) {
        logger.error('Failed to bill copilot usage from context usage API', {
          error: billingError,
          conversationId,
          assistantMessageId,
        })
      }
    }
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error fetching context usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const BILLING_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

interface TokenMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
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
  const sources = [usage?.tokenUsage, usage?.tokens, usage?.usageDetails]

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

  if (totalTokens !== undefined && completionTokens !== undefined && promptTokens === undefined) {
    promptTokens = totalTokens - completionTokens
  }

  if (promptTokens === undefined) {
    const fallbackTotal = totalTokens ?? completionTokens
    if (fallbackTotal !== undefined) {
      promptTokens = fallbackTotal - (completionTokens ?? 0)
    }
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

async function billCopilotUsage(params: {
  userId: string
  workflowId?: string
  assistantMessageId: string
  usage: any
  billingModel: string
  remoteModel?: string | null
}) {
  const { userId, workflowId, assistantMessageId, usage, billingModel, remoteModel } = params
  try {
    const metrics = extractTokenMetrics(usage)
    if (!metrics) {
      logger.info('Skipping copilot billing - no token metrics available', {
        assistantMessageId,
      })
      return
    }

    const billingKey = `copilot-billing:${assistantMessageId}`
    if (await hasProcessedMessage(billingKey)) {
      logger.info('Copilot billing already processed for message', { assistantMessageId })
      return
    }

    const modelToUse =
      typeof remoteModel === 'string' && remoteModel.length > 0 ? remoteModel : billingModel
    const normalizedModel = normalizeModelForBilling(modelToUse)

    const costResult = calculateCost(
      normalizedModel,
      metrics.promptTokens,
      metrics.completionTokens,
      false
    )
    const billingContext = workflowId
      ? await resolveWorkflowBillingContext({
          workflowId,
          actorUserId: userId,
        })
      : null
    const [subscription, defaultTier] = await Promise.all([
      billingContext
        ? Promise.resolve(billingContext.subscription)
        : getPersonalEffectiveSubscription(userId),
      requireDefaultBillingTier(),
    ])
    const effectiveTier = billingContext?.tier ?? subscription?.tier ?? defaultTier
    const costToAdd = Number(costResult.total || 0) * getTierCopilotCostMultiplier(effectiveTier)

    const extraUpdates: Record<string, any> = {
      totalCopilotCost: sql`total_copilot_cost + ${costToAdd}`,
      currentPeriodCopilotCost: sql`current_period_copilot_cost + ${costToAdd}`,
      totalCopilotCalls: sql`total_copilot_calls + 1`,
    }

    if (metrics.totalTokens > 0) {
      extraUpdates.totalCopilotTokens = sql`total_copilot_tokens + ${metrics.totalTokens}`
    }

    const didAccrue = await accrueUserUsageCost({
      userId,
      workflowId,
      cost: costToAdd,
      extraUpdates,
      reason: 'copilot_context_usage',
    })

    if (!didAccrue) {
      logger.warn('Copilot billing skipped - user stats record not found', {
        userId,
        workflowId,
      })
      return
    }

    await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)

    logger.info('Copilot billing recorded', {
      userId,
      billingUserId: billingContext?.billingUserId ?? userId,
      workflowId,
      assistantMessageId,
      cost: costToAdd,
      tokens: metrics.totalTokens,
      model: normalizedModel,
    })
  } catch (error) {
    logger.error('Failed to record copilot billing event', {
      error,
      userId,
      assistantMessageId,
    })
  }
}

function normalizeModelForBilling(model: string): string {
  const base = model.includes('/') ? model.split('/').pop() || model : model
  const lower = base.toLowerCase()
  if (MODEL_SYNONYMS[lower]) {
    return MODEL_SYNONYMS[lower]
  }
  return lower
}
