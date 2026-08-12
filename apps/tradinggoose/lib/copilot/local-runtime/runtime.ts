import {
  findConversationIdForToolCall,
  forgetToolCall,
  indexPendingToolCalls,
  loadConversation,
  saveConversation,
} from '@/lib/copilot/local-runtime/conversation-store'
import {
  assistantItemAdded,
  assistantItemDone,
  assistantTextDelta,
  awaitingToolsEvent,
  type CopilotSseEvent,
  errorEvent,
  functionCallItemDone,
  reasoningItemAdded,
  reasoningItemDone,
  reasoningTextDelta,
  responseCompletedEvent,
  startEvent,
} from '@/lib/copilot/local-runtime/events'
import { streamLlm } from '@/lib/copilot/local-runtime/llm'
import { buildLocalCopilotSystemPrompt } from '@/lib/copilot/local-runtime/prompt'
import { isLocalCopilotProvider } from '@/lib/copilot/local-runtime/providers'
import type {
  LocalCopilotContext,
  LocalCopilotConversation,
  LocalCopilotHistoryMessage,
  LocalCopilotMessage,
  LocalCopilotToolCall,
} from '@/lib/copilot/local-runtime/types'
import { getCopilotRuntimeToolManifest } from '@/lib/copilot/runtime-tool-manifest'
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { getProviderFromModel } from '@/providers/ai/models'
import { getApiKey } from '@/providers/ai/utils-server'

const logger = createLogger('LocalCopilotRuntime')

export interface LocalCopilotTurnRequest {
  message: string
  userId: string
  model: string
  conversationId?: string
  userName?: string
  workspaceId?: string
  context?: LocalCopilotContext[]
  /**
   * Persisted history, used only when nothing is cached for the conversation.
   * Cached state is richer — it carries tool calls and their results — so it wins
   * whenever it is still there.
   */
  history?: LocalCopilotHistoryMessage[]
}

export interface LocalCopilotMarkCompleteRequest {
  id: string
  name: string
  status: number
  message?: unknown
  data?: unknown
}

function sseResponse(events: AsyncGenerator<CopilotSseEvent>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await events.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(encodeSSE(value))
      } catch (error) {
        logger.error('Local Copilot stream failed', error)
        controller.enqueue(encodeSSE(errorEvent(describeError(error))))
        controller.close()
      }
    },
    cancel() {
      void events.return?.(undefined as never)
    },
  })

  return new Response(stream, { status: 200, headers: SSE_HEADERS })
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The local Copilot runtime hit an unexpected error.'
}

/** Starts a new turn, or continues an existing conversation with a new user message. */
export async function runLocalCopilotTurn(
  request: LocalCopilotTurnRequest,
  signal?: AbortSignal
): Promise<Response> {
  const provider = getProviderFromModel(request.model)
  if (!isLocalCopilotProvider(provider)) {
    return sseResponse(
      singleEvent(
        errorEvent(
          `${provider} is not supported by the local Copilot runtime. Pick a model from OpenAI, Anthropic, DeepSeek, OpenRouter, NVIDIA or Ollama.`
        )
      )
    )
  }

  const existing = request.conversationId ? await loadConversation(request.conversationId) : null
  const conversation: LocalCopilotConversation = existing
    ? {
        ...existing,
        // A new user message supersedes whatever the previous turn was waiting on.
        pendingToolCalls: [],
        model: request.model,
        provider,
        // The user can switch workspaces without starting a new chat.
        workspaceId: request.workspaceId ?? existing.workspaceId,
        contexts: request.context ?? existing.contexts,
      }
    : {
        id: request.conversationId || crypto.randomUUID(),
        userId: request.userId,
        model: request.model,
        provider,
        userName: request.userName,
        workspaceId: request.workspaceId,
        contexts: request.context ?? [],
        messages: rehydrateHistory(request.history),
        pendingToolCalls: [],
        updatedAt: Date.now(),
      }

  if (existing && existing.userId !== request.userId) {
    return sseResponse(singleEvent(errorEvent('Conversation not found.')))
  }

  conversation.messages.push({ role: 'user', content: request.message })

  return sseResponse(streamModelTurn(conversation, { emitStart: true, signal }))
}

/**
 * Records a tool result and, once every pending call for the turn has reported,
 * streams the model's continuation. Returns `null` while calls are still
 * outstanding so the caller can answer with a plain JSON ack, matching how the
 * hosted service behaved for parallel tool calls.
 */
export async function resumeLocalCopilotTurn(
  request: LocalCopilotMarkCompleteRequest,
  userId: string,
  signal?: AbortSignal
): Promise<Response | null> {
  const conversationId = await findConversationIdForToolCall(request.id)
  if (!conversationId) {
    logger.warn('No local conversation for tool call', { toolCallId: request.id })
    return null
  }

  const conversation = await loadConversation(conversationId)
  if (!conversation || conversation.userId !== userId) {
    return null
  }

  await forgetToolCall(request.id)

  conversation.messages.push({
    role: 'tool',
    toolCallId: request.id,
    name: request.name,
    content: serializeToolResult(request),
  })
  conversation.pendingToolCalls = conversation.pendingToolCalls.filter(
    (toolCall) => toolCall.id !== request.id
  )

  // Persist before streaming: the stream body is lazy, so a client that never
  // reads it would otherwise drop the tool result it just reported.
  await saveConversation(conversation)

  if (conversation.pendingToolCalls.length > 0) {
    return null
  }

  return sseResponse(streamModelTurn(conversation, { emitStart: false, signal }))
}

/** Drops any pending state so a later message does not resume a cancelled turn. */
export async function abortLocalCopilotTurn(conversationId: string, userId: string): Promise<void> {
  const conversation = await loadConversation(conversationId)
  if (!conversation || conversation.userId !== userId) return

  await Promise.all(conversation.pendingToolCalls.map((toolCall) => forgetToolCall(toolCall.id)))
  conversation.pendingToolCalls = []
  await saveConversation(conversation)
}

function serializeToolResult(request: LocalCopilotMarkCompleteRequest): string {
  // The browser reports an HTTP-like status; anything outside 2xx is a failure the
  // model needs to see as such rather than as an empty result.
  const succeeded = request.status >= 200 && request.status < 300
  const payload = request.data !== undefined ? request.data : request.message

  if (!succeeded) {
    const reason =
      typeof request.message === 'string' && request.message
        ? request.message
        : `Tool failed with status ${request.status}`
    return JSON.stringify({ success: false, error: reason })
  }

  if (payload === undefined) {
    return JSON.stringify({ success: true })
  }

  return typeof payload === 'string' ? payload : JSON.stringify(payload)
}

async function* singleEvent(event: CopilotSseEvent): AsyncGenerator<CopilotSseEvent> {
  yield event
}

/**
 * Rebuilds a conversation from the messages the chat route persisted. Tool calls
 * are not reconstructed: the database stores them for display, and replaying them
 * without their results would leave the model with dangling calls.
 */
function rehydrateHistory(
  history: LocalCopilotHistoryMessage[] | undefined
): LocalCopilotMessage[] {
  if (!history?.length) return []

  return history.flatMap((message): LocalCopilotMessage[] => {
    const content = message.content?.trim()
    if (!content) return []

    if (message.role === 'assistant') {
      return [{ role: 'assistant', content }]
    }

    return message.role === 'user' ? [{ role: 'user', content }] : []
  })
}

/**
 * Runs exactly one model call and translates it into the hosted SSE vocabulary.
 * The turn ends either completed or parked on tool calls; the browser resumes it
 * through `resumeLocalCopilotTurn`.
 */
async function* streamModelTurn(
  conversation: LocalCopilotConversation,
  options: { emitStart: boolean; signal?: AbortSignal }
): AsyncGenerator<CopilotSseEvent> {
  if (options.emitStart) {
    yield startEvent(conversation.id)
  }

  const apiKey = await getApiKey(conversation.provider, conversation.model)
  const manifest = await getCopilotRuntimeToolManifest()
  const systemPrompt = buildLocalCopilotSystemPrompt({
    contexts: conversation.contexts,
    userName: conversation.userName,
    workspaceId: conversation.workspaceId,
  })

  let textItemId: string | null = null
  let textBuffer = ''
  let reasoningItemId: string | null = null
  let reasoningBuffer = ''
  const toolCallsByIndex = new Map<number, LocalCopilotToolCall>()

  const closeReasoning = function* (): Generator<CopilotSseEvent> {
    if (reasoningItemId === null) return
    yield reasoningItemDone(reasoningItemId, reasoningBuffer)
    reasoningItemId = null
    reasoningBuffer = ''
  }

  const closeText = function* (): Generator<CopilotSseEvent> {
    if (textItemId === null) return
    yield assistantItemDone(textItemId, textBuffer)
    textItemId = null
  }

  const deltas = streamLlm({
    provider: conversation.provider,
    model: conversation.model,
    apiKey,
    systemPrompt,
    // A snapshot: this turn's own assistant reply is appended to the live array
    // below, and must not leak into the request that produced it.
    messages: [...conversation.messages],
    tools: manifest.tools,
    signal: options.signal,
  })

  let assistantText = ''
  let assistantReasoning = ''

  for await (const delta of deltas) {
    switch (delta.type) {
      case 'reasoning': {
        // Models emit reasoning before the answer; a reasoning chunk after text
        // has started means a new block, so the open text item is finalized.
        if (reasoningItemId === null) {
          yield* closeText()
          reasoningItemId = crypto.randomUUID()
          yield reasoningItemAdded(reasoningItemId)
        }
        reasoningBuffer += delta.delta
        assistantReasoning += delta.delta
        yield reasoningTextDelta(reasoningItemId, delta.delta)
        break
      }

      case 'text': {
        if (textItemId === null) {
          yield* closeReasoning()
          textItemId = crypto.randomUUID()
          textBuffer = ''
          yield assistantItemAdded(textItemId)
        }
        textBuffer += delta.delta
        assistantText += delta.delta
        yield assistantTextDelta(textItemId, delta.delta)
        break
      }

      case 'tool_call_start': {
        toolCallsByIndex.set(delta.index, { id: delta.id, name: delta.name, arguments: '' })
        break
      }

      case 'tool_call_arguments': {
        const toolCall = toolCallsByIndex.get(delta.index)
        if (toolCall) {
          toolCall.arguments += delta.delta
        }
        break
      }

      case 'usage':
        break
    }
  }

  yield* closeReasoning()
  yield* closeText()

  const toolCalls = [...toolCallsByIndex.values()].filter((toolCall) => toolCall.name.length > 0)

  conversation.messages.push({
    role: 'assistant',
    content: assistantText,
    ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  })

  if (toolCalls.length === 0) {
    conversation.pendingToolCalls = []
    await saveConversation(conversation)
    yield responseCompletedEvent(crypto.randomUUID())
    return
  }

  for (const toolCall of toolCalls) {
    yield functionCallItemDone(toolCall)
  }

  conversation.pendingToolCalls = toolCalls
  await saveConversation(conversation)
  await indexPendingToolCalls(
    conversation.id,
    toolCalls.map((toolCall) => toolCall.id)
  )

  yield awaitingToolsEvent(toolCalls)
}
