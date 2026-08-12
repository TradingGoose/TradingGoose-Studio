import { loadConversation } from '@/lib/copilot/local-runtime/conversation-store'
import {
  abortLocalCopilotTurn,
  type LocalCopilotMarkCompleteRequest,
  resumeLocalCopilotTurn,
  runLocalCopilotTurn,
} from '@/lib/copilot/local-runtime/runtime'
import type {
  LocalCopilotContext,
  LocalCopilotHistoryMessage,
} from '@/lib/copilot/local-runtime/types'
import { createLogger } from '@/lib/logs/console/logger'
import { PROVIDER_DEFINITIONS } from '@/providers/ai/models'

const logger = createLogger('LocalCopilotDispatch')

const DEFAULT_CONTEXT_WINDOW = 128_000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function contextWindowForModel(model: string): number {
  const normalized = model.toLowerCase()
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const match = provider.models.find((entry) => entry.id.toLowerCase() === normalized)
    if (match?.contextWindow) return match.contextWindow
  }
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Rough token estimate. The local runtime has no upstream tokenizer to ask, and
 * this only drives the context-usage pill, so an approximation beats an extra
 * round trip to the provider.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function handleContextUsage(body: Record<string, unknown>): Promise<Response> {
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const conversation = conversationId ? await loadConversation(conversationId) : null

  if (!conversation) {
    return jsonResponse({ tokensUsed: 0, percentage: 0, model, contextWindow: 0 })
  }

  const tokensUsed = conversation.messages.reduce((total, message) => {
    const text =
      message.role === 'assistant'
        ? `${message.content}${message.reasoning ?? ''}${(message.toolCalls ?? [])
            .map((toolCall) => toolCall.arguments)
            .join('')}`
        : message.content
    return total + estimateTokens(text)
  }, 0)

  const contextWindow = contextWindowForModel(conversation.model || model)

  return jsonResponse({
    tokensUsed,
    percentage: contextWindow > 0 ? Math.min(100, (tokensUsed / contextWindow) * 100) : 0,
    model: conversation.model || model,
    contextWindow,
    when: 'end',
  })
}

/**
 * Serves the hosted Copilot service's endpoints from inside this deployment.
 * Returning a `Response` keeps every caller of `proxyCopilotRequest` unchanged —
 * they cannot tell whether the stream came from copilot.tradinggoose.ai or from
 * the local runtime.
 */
export async function dispatchLocalCopilotRequest(params: {
  endpoint: string
  body?: Record<string, unknown>
  userId?: string
  signal?: AbortSignal
}): Promise<Response> {
  const body = params.body ?? {}

  switch (params.endpoint) {
    case '/api/copilot': {
      const userId = typeof body.userId === 'string' ? body.userId : params.userId
      if (!userId) {
        return jsonResponse({ error: 'userId is required' }, 400)
      }

      return await runLocalCopilotTurn(
        {
          message: typeof body.message === 'string' ? body.message : '',
          userId,
          model: typeof body.model === 'string' ? body.model : '',
          conversationId: typeof body.conversationId === 'string' ? body.conversationId : undefined,
          userName: typeof body.userName === 'string' ? body.userName : undefined,
          workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
          context: Array.isArray(body.context)
            ? (body.context as LocalCopilotContext[])
            : undefined,
          history: Array.isArray(body.history)
            ? (body.history as LocalCopilotHistoryMessage[])
            : undefined,
        },
        params.signal
      )
    }

    case '/api/tools/mark-complete': {
      if (!params.userId) {
        return jsonResponse({ error: 'userId is required' }, 400)
      }

      const continuation = await resumeLocalCopilotTurn(
        body as unknown as LocalCopilotMarkCompleteRequest,
        params.userId,
        params.signal
      )

      // No continuation means other tool calls in the same turn are still
      // outstanding, which the caller relays to the browser as a plain ack.
      return continuation ?? jsonResponse({ success: true })
    }

    case '/api/tools/abort-turn': {
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
      const userId = typeof body.userId === 'string' ? body.userId : params.userId
      if (conversationId && userId) {
        await abortLocalCopilotTurn(conversationId, userId)
      }
      return jsonResponse({ success: true })
    }

    case '/api/get-context-usage':
      return await handleContextUsage(body)

    // Telemetry and hosted-account key management have no local equivalent.
    case '/api/stats':
      return jsonResponse({ success: true })

    case '/api/validate-key/get-api-keys':
      return jsonResponse([])

    case '/api/validate-key/generate':
    case '/api/validate-key/delete':
      return jsonResponse(
        { error: 'Copilot API keys are managed by the hosted service and unused in local mode.' },
        400
      )

    default:
      logger.warn('Unhandled local Copilot endpoint', { endpoint: params.endpoint })
      return jsonResponse({ error: `Unsupported local Copilot endpoint: ${params.endpoint}` }, 404)
  }
}
