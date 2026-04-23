import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getPersonalEffectiveSubscription } from '@/lib/billing/core/subscription'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierCopilotCostMultiplier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import { resolveWorkflowBillingContext } from '@/lib/billing/workspace-billing'
import {
  adjustCopilotUsageReservation,
  releaseCopilotUsageReservation,
  reserveCopilotUsage,
} from '@/lib/copilot/usage-reservations'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { COPILOT_RUNTIME_PROVIDER_IDS } from '@/lib/copilot/runtime-provider'
import { buildCopilotRuntimeProviderConfig } from '@/lib/copilot/runtime-provider.server'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { getCopilotApiUrl, proxyCopilotRequest } from '@/app/api/copilot/proxy'
import { calculateCost } from '@/providers/ai/utils'

const BILLING_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const DEFAULT_ESTIMATED_RESERVATION_USD = 1
const BILLING_DISABLED_RESERVATION_ID = 'billing-disabled'
const logger = createLogger('CopilotUsageAPI')

const ContextUsageRequestSchema = z.object({
  kind: z.literal('context'),
  conversationId: z.string(),
  model: z.enum(COPILOT_RUNTIME_MODELS),
  workflowId: z.string().optional(),
  provider: z.enum(COPILOT_RUNTIME_PROVIDER_IDS).optional(),
  bill: z.boolean().optional(),
  assistantMessageId: z.string().optional(),
  billingModel: z.string().optional(),
  userId: z.string().optional(),
})

const UsageEstimateSchema = z.object({
  model: z.string().min(1, 'model is required'),
  estimatedPromptTokens: z.number().int().nonnegative(),
  reservedCompletionTokens: z.number().int().nonnegative(),
})

const ReserveUsageUsdRequestSchema = z.object({
  action: z.literal('reserve'),
  userId: z.string().min(1, 'userId is required'),
  workflowId: z.string().min(1).optional(),
  requestedUsd: z.number().positive('requestedUsd must be positive'),
  reason: z.string().min(1).optional(),
})

const ReserveUsageEstimatedRequestSchema = z.object({
  action: z.literal('reserve'),
  userId: z.string().min(1, 'userId is required'),
  workflowId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).merge(UsageEstimateSchema)

const ReserveUsageRequestSchema = z.union([
  ReserveUsageUsdRequestSchema,
  ReserveUsageEstimatedRequestSchema,
])

const AdjustUsageRequestSchema = z.object({
  action: z.literal('adjust'),
  reservationId: z.string().min(1, 'reservationId is required'),
  userId: z.string().min(1, 'userId is required'),
  workflowId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).merge(UsageEstimateSchema)

const ContextCommitRequestSchema = z.object({
  action: z.literal('commit'),
  kind: z.literal('context'),
  conversationId: z.string(),
  model: z.enum(COPILOT_RUNTIME_MODELS),
  workflowId: z.string().optional(),
  provider: z.enum(COPILOT_RUNTIME_PROVIDER_IDS).optional(),
  assistantMessageId: z.string().min(1, 'assistantMessageId is required'),
  billingModel: z.string().optional(),
  userId: z.string().min(1, 'userId is required'),
  reservationId: z.string().min(1).optional(),
})

const CompletionCommitRequestSchema = z.object({
  action: z.literal('commit'),
  kind: z.literal('completion'),
  userId: z.string().min(1, 'userId is required'),
  model: z.string().min(1, 'model is required'),
  usage: z.unknown(),
  remoteModel: z.string().optional(),
  completionId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  reservationId: z.string().min(1).optional(),
})

const ReleaseUsageRequestSchema = z.object({
  action: z.literal('release'),
  reservationId: z.string().min(1, 'reservationId is required'),
})

interface TokenMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

type UsageBillingResult =
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

function normalizeModelForBilling(model: string): string {
  const base = model.includes('/') ? model.split('/').pop() || model : model
  return base.toLowerCase()
}

async function recordBilledUsage(params: {
  userId: string
  workflowId?: string
  usage: any
  billingModel: string
  remoteModel?: string | null
  billingKeyPrefix: 'copilot-billing' | 'copilot-completion-billing'
  billingKeyId?: string | null
  reason: 'copilot_context_usage' | 'copilot_completion_usage'
}): Promise<UsageBillingResult> {
  const { userId, workflowId, usage, billingModel, remoteModel, billingKeyPrefix, billingKeyId, reason } =
    params

  const metrics = extractTokenMetrics(usage)
  if (!metrics) {
    logger.info('Skipping copilot billing - no token metrics available', {
      billingKeyPrefix,
      billingKeyId,
      reason,
    })
    return { billed: false, reason: 'no_token_metrics' }
  }

  const billingKey = billingKeyId ? `${billingKeyPrefix}:${billingKeyId}` : null
  if (billingKey && (await hasProcessedMessage(billingKey))) {
    logger.info('Copilot billing already processed', { billingKey, reason })
    return { billed: false, duplicate: true }
  }

  const { costUsd: costToAdd, normalizedModel, billingContext } = await calculateCopilotCostUsd({
    userId,
    workflowId,
    billingModel,
    remoteModel,
    promptTokens: metrics.promptTokens,
    completionTokens: metrics.completionTokens,
  })
  if (costToAdd <= 0) {
    logger.info('Skipping copilot billing - calculated cost is zero', {
      userId,
      workflowId,
      billingKeyId,
      model: normalizedModel,
      reason,
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
    userId,
    workflowId,
    cost: costToAdd,
    extraUpdates,
    reason,
  })

  if (!didAccrue) {
    logger.warn('Copilot billing skipped - ledger record not found', {
      userId,
      workflowId,
      billingKeyId,
      reason,
    })
    return { billed: false, reason: 'ledger_not_found' }
  }

  if (billingKey) {
    await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)
  }

  logger.info('Copilot billing recorded', {
    userId,
    billingUserId: billingContext?.billingUserId ?? userId,
    workflowId,
    billingKeyId,
    cost: costToAdd,
    tokens: metrics.totalTokens,
    model: normalizedModel,
    reason,
  })

  return {
    billed: true,
    duplicate: false,
    cost: costToAdd,
    tokens: metrics.totalTokens,
    model: normalizedModel,
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
    ? billingContext?.subscription?.tier ?? null
    : (await getPersonalEffectiveSubscription(params.userId))?.tier ?? null

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
  remoteModel?: string | null
  promptTokens: number
  completionTokens: number
  fallbackUsd?: number
}): Promise<{
  costUsd: number
  normalizedModel: string
  billingContext: Awaited<ReturnType<typeof resolveWorkflowBillingContext>> | null
}> {
  const modelToUse =
    typeof params.remoteModel === 'string' && params.remoteModel.length > 0
      ? params.remoteModel
      : params.billingModel
  const normalizedModel = normalizeModelForBilling(modelToUse)
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
    costUsd: rawCostUsd > 0 ? rawCostUsd : params.fallbackUsd ?? 0,
    normalizedModel,
    billingContext,
  }
}

async function calculateReservationUsdFromEstimate(params: {
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

async function fetchContextUsageFromCopilot(params: {
  conversationId: string
  model: z.infer<typeof ContextUsageRequestSchema>['model']
  workflowId?: string
  provider?: z.infer<typeof ContextUsageRequestSchema>['provider']
  userId: string
}) {
  const { conversationId, model, workflowId, provider, userId } = params
  const { providerConfig } = await buildCopilotRuntimeProviderConfig({
    model,
    provider,
  })

  const requestPayload = {
    conversationId,
    model,
    userId,
    ...(workflowId ? { workflowId } : {}),
    provider: providerConfig,
  }

  logger.info('[Usage API] Calling copilot for context usage', {
    url: await getCopilotApiUrl('/api/get-context-usage'),
    payload: requestPayload,
  })

  return proxyCopilotRequest({
    endpoint: '/api/get-context-usage',
    body: requestPayload,
  })
}

async function handleContextUsage(
  req: NextRequest,
  payload: z.infer<typeof ContextUsageRequestSchema>
): Promise<NextResponse> {
  const { conversationId, model, workflowId, provider, bill, assistantMessageId, billingModel } =
    payload
  const internalAuth = checkInternalApiKey(req)
  const session = !internalAuth.success ? await getSession() : null
  const userId = internalAuth.success ? payload.userId : session?.user?.id

  if (!userId) {
    logger.warn('[Usage API] No session/user ID for context usage')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const simAgentResponse = await fetchContextUsageFromCopilot({
    conversationId,
    model,
    workflowId,
    provider,
    userId,
  })

  if (!simAgentResponse.ok) {
    const errorText = await simAgentResponse.text().catch(() => '')
    logger.warn('[Usage API] TradingGoose agent request failed', {
      status: simAgentResponse.status,
      error: errorText,
    })
    return NextResponse.json(
      { error: 'Failed to fetch context usage from copilot' },
      { status: simAgentResponse.status }
    )
  }

  const data = await simAgentResponse.json()

  const shouldBill = Boolean(bill && assistantMessageId && !internalAuth.success && !isHosted)
  if (!shouldBill) {
    return NextResponse.json(data)
  }

  if (!(await isBillingEnabledForRuntime())) {
    return NextResponse.json({
      ...data,
      billing: { billed: false, reason: 'billing_disabled' },
    })
  }

  try {
    const billing = await recordBilledUsage({
      userId,
      workflowId,
      usage: data,
      billingModel: billingModel || model,
      remoteModel: data?.model,
      billingKeyPrefix: 'copilot-billing',
      billingKeyId: assistantMessageId,
      reason: 'copilot_context_usage',
    })
    return NextResponse.json({
      ...data,
      billing,
    })
  } catch (billingError) {
    logger.error('Failed to bill copilot context usage', {
      error: billingError,
      conversationId,
      assistantMessageId,
    })
    return NextResponse.json({
      ...data,
      billing: { billed: false, reason: 'ledger_not_found' },
    })
  }
}

async function releaseCommittedReservation(reservationId?: string): Promise<void> {
  if (!reservationId) return
  if (reservationId === BILLING_DISABLED_RESERVATION_ID) {
    return
  }

  await releaseCopilotUsageReservation({ reservationId }).catch((error) => {
    logger.warn('Failed to release copilot usage reservation after commit', {
      reservationId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function withCommittedReservationRelease<T>(
  reservationId: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation()
  } finally {
    await releaseCommittedReservation(reservationId)
  }
}

function buildBillingDisabledReservation(params: {
  userId: string
  reservationId?: string
}) {
  return {
    allowed: true,
    status: 200,
    reservationId: params.reservationId ?? BILLING_DISABLED_RESERVATION_ID,
    reservedUsd: 0,
    currentUsage: 0,
    limit: Number.MAX_SAFE_INTEGER,
    remaining: Number.MAX_SAFE_INTEGER,
    activeReservedUsd: 0,
    scopeType: 'user' as const,
    scopeId: params.userId,
  }
}

async function handleReserveUsage(
  req: NextRequest,
  payload: z.infer<typeof ReserveUsageRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  if (!(await isBillingEnabledForRuntime())) {
    return NextResponse.json(buildBillingDisabledReservation({ userId: payload.userId }))
  }

  const requestedUsd =
    'requestedUsd' in payload
      ? payload.requestedUsd
      : await calculateReservationUsdFromEstimate({
          userId: payload.userId,
          workflowId: payload.workflowId,
          model: payload.model,
          estimatedPromptTokens: payload.estimatedPromptTokens,
          reservedCompletionTokens: payload.reservedCompletionTokens,
        })

  const result = await reserveCopilotUsage({
    userId: payload.userId,
    workflowId: payload.workflowId,
    requestedUsd,
    reason: payload.reason,
  })

  return NextResponse.json(result, { status: result.status })
}

async function handleAdjustUsage(
  req: NextRequest,
  payload: z.infer<typeof AdjustUsageRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  if (!(await isBillingEnabledForRuntime())) {
    return NextResponse.json(
      buildBillingDisabledReservation({
        userId: payload.userId,
        reservationId: payload.reservationId,
      })
    )
  }

  const requestedUsd = await calculateReservationUsdFromEstimate({
    userId: payload.userId,
    workflowId: payload.workflowId,
    model: payload.model,
    estimatedPromptTokens: payload.estimatedPromptTokens,
    reservedCompletionTokens: payload.reservedCompletionTokens,
  })

  const result = await adjustCopilotUsageReservation({
    reservationId: payload.reservationId,
    userId: payload.userId,
    workflowId: payload.workflowId,
    requestedUsd,
    reason: payload.reason,
  })

  return NextResponse.json(result, { status: result.status })
}

async function handleContextCommit(
  req: NextRequest,
  payload: z.infer<typeof ContextCommitRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  return withCommittedReservationRelease(payload.reservationId, async () => {
    const simAgentResponse = await fetchContextUsageFromCopilot({
      conversationId: payload.conversationId,
      model: payload.model,
      workflowId: payload.workflowId,
      provider: payload.provider,
      userId: payload.userId,
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text().catch(() => '')
      logger.warn('[Usage API] TradingGoose agent request failed during commit', {
        status: simAgentResponse.status,
        error: errorText,
        reservationId: payload.reservationId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch context usage from copilot' },
        { status: simAgentResponse.status }
      )
    }

    const data = await simAgentResponse.json()

    if (!(await isBillingEnabledForRuntime())) {
      return NextResponse.json({
        ...data,
        billing: { billed: false, reason: 'billing_disabled' },
      })
    }

    const billing = await recordBilledUsage({
      userId: payload.userId,
      workflowId: payload.workflowId,
      usage: data,
      billingModel: payload.billingModel || payload.model,
      remoteModel: data?.model,
      billingKeyPrefix: 'copilot-billing',
      billingKeyId: payload.assistantMessageId,
      reason: 'copilot_context_usage',
    })

    return NextResponse.json({
      ...data,
      billing,
    })
  })
}

async function handleCompletionCommit(
  req: NextRequest,
  payload: z.infer<typeof CompletionCommitRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  return withCommittedReservationRelease(payload.reservationId, async () => {
    if (!(await isBillingEnabledForRuntime())) {
      return NextResponse.json({
        success: true,
        billing: { billed: false, reason: 'billing_disabled' },
      })
    }

    const billing = await recordBilledUsage({
      userId: payload.userId,
      workflowId: payload.workflowId,
      usage: payload.usage,
      billingModel: payload.model,
      remoteModel: payload.remoteModel,
      billingKeyPrefix: 'copilot-completion-billing',
      billingKeyId: payload.completionId,
      reason: 'copilot_completion_usage',
    })

    return NextResponse.json({
      success: true,
      billing,
    })
  })
}

async function handleReleaseUsage(
  req: NextRequest,
  payload: z.infer<typeof ReleaseUsageRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  if (payload.reservationId === BILLING_DISABLED_RESERVATION_ID) {
    return NextResponse.json({
      released: true,
      reservationId: payload.reservationId,
    })
  }

  const result = await releaseCopilotUsageReservation({
    reservationId: payload.reservationId,
  })

  return NextResponse.json(result)
}

/**
 * POST /api/copilot/usage
 * Unified copilot usage endpoint for context inspection/billing and raw completion billing.
 */
export async function POST(req: NextRequest) {
  try {
    const text = await req.text()
    if (!text) {
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const action = body && typeof body === 'object' ? (body as Record<string, unknown>).action : null
    if (action === 'reserve') {
      const parsed = ReserveUsageRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage reserve request', { errors: parsed.error.errors })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.errors,
          },
          { status: 400 }
        )
      }
      return await handleReserveUsage(req, parsed.data)
    }

    if (action === 'adjust') {
      const parsed = AdjustUsageRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage adjust request', { errors: parsed.error.errors })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.errors,
          },
          { status: 400 }
        )
      }
      return await handleAdjustUsage(req, parsed.data)
    }

    if (action === 'commit') {
      const kind = body && typeof body === 'object' ? (body as Record<string, unknown>).kind : null
      const parsed =
        kind === 'context'
          ? ContextCommitRequestSchema.safeParse(body)
          : kind === 'completion'
            ? CompletionCommitRequestSchema.safeParse(body)
            : null

      if (!parsed || !parsed.success) {
        logger.warn('Invalid copilot usage commit request', {
          errors: parsed && !parsed.success ? parsed.error.errors : [{ message: 'Invalid commit kind' }],
        })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed && !parsed.success ? parsed.error.errors : [{ message: 'Invalid commit kind' }],
          },
          { status: 400 }
        )
      }

      if (parsed.data.kind === 'context') {
        return await handleContextCommit(req, parsed.data)
      }

      return await handleCompletionCommit(req, parsed.data)
    }

    if (action === 'release') {
      const parsed = ReleaseUsageRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage release request', { errors: parsed.error.errors })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.errors,
          },
          { status: 400 }
        )
      }
      return await handleReleaseUsage(req, parsed.data)
    }

    const parsed = ContextUsageRequestSchema.safeParse(body)

    if (!parsed.success) {
      logger.warn('Invalid copilot usage request', { errors: parsed.error.errors })
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.errors,
        },
        { status: 400 }
      )
    }

    return await handleContextUsage(req, parsed.data)
  } catch (error) {
    logger.error('Failed to process copilot usage request', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
