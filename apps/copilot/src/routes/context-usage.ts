import type { Hono } from 'hono'
import { DEFAULT_CONTEXT_WINDOW } from '../core/constants'
import { ContextUsageSchema } from '../core/schemas'
import type { AppBindings } from '../core/types'
import { estimateTokensFallback, getUsageSnapshot } from '../services/usage'
import { config } from '../core/config'

export const registerContextUsageRoutes = (app: Hono<AppBindings>) => {
  app.post('/api/get-context-usage', async (c) => {

    const body = await c.req.json().catch(() => ({}))
    const parsed = ContextUsageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const { chatId, model, workflowId, userId } = parsed.data
    const cachedUsage = getUsageSnapshot(chatId)

    const normalized = cachedUsage?.normalizedUsage
    const estimatedTokens = estimateTokensFallback(body, workflowId, userId)
    const contextWindow =
      normalized?.contextWindow ?? cachedUsage?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const tokensUsed = cachedUsage?.tokensUsed ?? normalized?.totalTokens ?? estimatedTokens
    const percentage =
      cachedUsage?.percentage ??
      (contextWindow > 0 && typeof tokensUsed === 'number'
        ? Math.min(100, (tokensUsed / contextWindow) * 100)
        : 0)

    const usageNumeric = tokensUsed
    let usagePayload =
      cachedUsage?.usage ??
      cachedUsage?.tokenUsage ??
      cachedUsage?.tokens ??
      (normalized
        ? {
          total_tokens: normalized.totalTokens,
          prompt_tokens: normalized.promptTokens,
          completion_tokens: normalized.completionTokens,
          context_window: normalized.contextWindow,
        }
        : undefined)

    const incomingKey = c.req.header('x-api-key')
    if (config.internalApiSecret && incomingKey === config.internalApiSecret) {
      usagePayload.total_tokens = 0
      usagePayload.promptTokens = 0
      usagePayload.completion_tokens = 0
    }

    return c.json({
      tokensUsed,
      usage: usageNumeric,
      percentage,
      model: cachedUsage?.model || model,
      contextWindow,
      when: 'end',
      estimatedTokens,
      tokenUsage: cachedUsage?.tokenUsage ?? normalized?.raw,
      tokens: cachedUsage?.tokens ?? normalized?.raw,
      usageDetails: usagePayload,
    })
  })
}
