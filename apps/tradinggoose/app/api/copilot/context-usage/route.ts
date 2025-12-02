import { db } from '@tradinggoose/db'
import { userStats } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { getSession } from '@/lib/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { isBillingEnabled } from '@/lib/environment'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { COPILOT_API_URL_DEFAULT } from '@/lib/sim-agent/constants'
import { calculateCost } from '@/providers/utils'
import { checkInternalApiKey } from '@/lib/copilot/utils'

const MODEL_SYNONYMS: Record<string, string> = {
  'claude-sonnet-4.5': 'claude-sonnet-4-5',
  'claude-4.5-sonnet': 'claude-sonnet-4-5',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  'claude-4.5-haiku': 'claude-haiku-4-5',
  'claude-opus-4.5': 'claude-opus-4-5',
  'claude-4.5-opus': 'claude-opus-4-5',
}

const logger = createLogger('ContextUsageAPI')

const COPILOT_API_URL = env.COPILOT_API_URL || COPILOT_API_URL_DEFAULT

const ContextUsageRequestSchema = z.object({
  chatId: z.string(),
  model: z.string(),
  workflowId: z.string(),
  provider: z.any().optional(),
  bill: z.boolean().optional(),
  assistantMessageId: z.string().optional(),
  billingModel: z.string().optional(),
  userId: z.string().optional(),
})

/**
 * POST /api/copilot/context-usage
 * Fetch context usage from sim-agent API
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

    const { chatId, model, workflowId, provider, bill, assistantMessageId, billingModel } =
      parsed.data
    const internalAuth = checkInternalApiKey(req)
    const session = !internalAuth.success ? await getSession() : null

    const userId = internalAuth.success ? parsed.data.userId : session?.user?.id
    if (!userId) {
      logger.warn('[Context Usage API] No session/user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('[Context Usage API] Request validated', {
      chatId,
      model,
      userId,
      workflowId,
      bill,
      assistantMessageId,
    })

    // Build provider config similar to chat route
    let providerConfig: CopilotProviderConfig | undefined = provider
    if (!providerConfig) {
      const defaults = getCopilotModel('chat')
      const modelToUse = env.COPILOT_MODEL || defaults.model
      const providerEnv = env.COPILOT_PROVIDER as any

      if (providerEnv) {
        if (providerEnv === 'azure-openai') {
          providerConfig = {
            provider: 'azure-openai',
            model: modelToUse,
            apiKey: env.AZURE_OPENAI_API_KEY,
            apiVersion: env.AZURE_OPENAI_API_VERSION,
            endpoint: env.AZURE_OPENAI_ENDPOINT,
          }
        } else {
          providerConfig = {
            provider: providerEnv,
            model: modelToUse,
            apiKey: env.COPILOT_API_KEY,
          }
        }
      }
    }

    // Call sim-agent API
    const requestPayload = {
      chatId,
      model,
      userId,
      workflowId,
      ...(providerConfig ? { provider: providerConfig } : {}),
    }

    logger.info('[Context Usage API] Calling sim-agent', {
      url: `${COPILOT_API_URL}/api/get-context-usage`,
      payload: requestPayload,
    })

    const simAgentResponse = await fetch(`${COPILOT_API_URL}/api/get-context-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
    })

    logger.info('[Context Usage API] Sim-agent response', {
      status: simAgentResponse.status,
      ok: simAgentResponse.ok,
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text().catch(() => '')
      logger.warn('[Context Usage API] Sim agent request failed', {
        status: simAgentResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { error: 'Failed to fetch context usage from sim-agent' },
        { status: simAgentResponse.status }
      )
    }

    const data = await simAgentResponse.json()
    logger.info('[Context Usage API] Sim-agent data received', data)

    if (bill && assistantMessageId && isBillingEnabled) {
      try {
          await billCopilotUsage({
            userId,
            assistantMessageId,
            usage: data,
            billingModel: billingModel || model,
            remoteModel: data?.model,
          })
      } catch (billingError) {
        logger.error('Failed to bill copilot usage from context usage API', {
          error: billingError,
          chatId,
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
  assistantMessageId: string
  usage: any
  billingModel: string
  remoteModel?: string | null
}) {
  const { userId, assistantMessageId, usage, billingModel, remoteModel } = params
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
    const costToAdd = Number(costResult.total || 0)

    const updateFields: Record<string, any> = {
      totalCost: sql`total_cost + ${costToAdd}`,
      currentPeriodCost: sql`current_period_cost + ${costToAdd}`,
      totalCopilotCost: sql`total_copilot_cost + ${costToAdd}`,
      totalCopilotCalls: sql`total_copilot_calls + 1`,
      lastActive: new Date(),
    }

    if (metrics.totalTokens > 0) {
      updateFields.totalCopilotTokens = sql`total_copilot_tokens + ${metrics.totalTokens}`
    }

    const updateResult = await db
      .update(userStats)
      .set(updateFields)
      .where(eq(userStats.userId, userId))
      .returning({ id: userStats.id })

    if (updateResult.length === 0) {
      logger.warn('Copilot billing skipped - user stats record not found', { userId })
      return
    }

    await checkAndBillOverageThreshold(userId)
    await markMessageAsProcessed(billingKey, BILLING_EVENT_TTL_SECONDS)

    logger.info('Copilot billing recorded', {
      userId,
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
