import OpenAI from 'openai'
import { db } from '@tradinggoose/db'
import { copilotReviewSessions } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveVllmServiceConfig } from '@/lib/system-services/runtime'
import { SSE_HEADERS, encodeSSE } from '@/lib/utils'
import { runLocalCopilotTurn } from '@/lib/copilot/local-runtime/agent'
import {
  persistLocalWorkingMessage,
  persistLocalContinuation,
} from '@/lib/copilot/local-runtime/persistence'
import { LOCAL_COPILOT_MODEL_PREFIX } from '@/lib/copilot/local-runtime/runtime-models'
import type { LocalWorkingMessage } from '@/lib/copilot/local-runtime/working-messages'

const logger = createLogger('LocalCopilotChatHandler')

export interface LocalChatHandlerParams {
  model: string
  /** Raw user text, persisted as the user transcript item. */
  message: string
  /** Message after workspace entity mentions were resolved, sent to the model. */
  modelMessage: string
  userMessageId: string
  reviewSessionId: string
  conversationId?: string
  workspaceId?: string
  userId: string
  contexts?: Array<{ type: string; tag?: string; content: string }>
  fileContents?: Array<{ filename?: string; mediaType?: string; content?: string }>
  fileAttachments?: unknown
  contextsInput?: unknown
  requestId: string
  /**
   * Server tools run in-process here, so there is no approval round-trip: the
   * route does not carry an access level or review-entity context. Local turns
   * therefore execute as 'limited', the same level the managed runtime uses for
   * auto-accepted reviews.
   */
  sessionCreatedThisRequest?: boolean
}

export interface LocalContinuationHandlerParams {
  model: string
  reviewSessionId: string
  userId: string
  requestId: string
  continuation: {
    toolCallId: string
    toolName: string
    status: number
    message?: unknown
    data?: unknown
  }
}

function parseAssistantText(messages: LocalWorkingMessage[]): string {
  return messages
    .filter((message) => message.role === 'assistant' && typeof message.content === 'string')
    .map((message) => message.content as string)
    .join('')
}

/**
 * Persists the assistant transcript item for a completed turn. Uses the same
 * review-item shape the managed runtime writes, so the client renders local
 * turns identically.
 */
async function persistAssistantTranscript(params: {
  reviewSessionId: string
  assistantMessageId: string
  content: string
}): Promise<void> {
  const { persistLocalReviewMessage } = await import('@/lib/copilot/local-runtime/persistence')
  await persistLocalReviewMessage({
    reviewSessionId: params.reviewSessionId,
    itemId: params.assistantMessageId,
    role: 'assistant',
    content: params.content,
  })
}

/**
 * Streams a full local Copilot turn (inference + tool execution + review
 * staging) to the client using the same SSE contract as the managed runtime.
 */
export async function handleLocalCopilotChat(
  params: LocalChatHandlerParams
): Promise<Response> {
  const conversationId = params.conversationId || params.reviewSessionId
  const assistantMessageId = `local_assistant_${crypto.randomUUID()}`
  const bareModel = params.model.startsWith(LOCAL_COPILOT_MODEL_PREFIX)
    ? params.model.slice(LOCAL_COPILOT_MODEL_PREFIX.length)
    : params.model

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: Record<string, unknown> = {}) => {
        if (closed) return
        controller.enqueue(encodeSSE({ type: event, ...data }))
      }

      try {
        send('review_session_id', { reviewSessionId: params.reviewSessionId })
        send('start', { data: { conversationId } })
        send('turn_state', { status: 'in_progress', phase: 'streaming' })

        await db
          .update(copilotReviewSessions)
          .set({
            model: `${LOCAL_COPILOT_MODEL_PREFIX}${bareModel}`,
            conversationId,
            updatedAt: new Date(),
          })
          .where(eq(copilotReviewSessions.id, params.reviewSessionId))

        const priorWorkingMessages = await loadLocalWorkingHistory(params.reviewSessionId)

        // Record the user's turn in the working history first, so a later turn
        // (or a crash mid-turn) still replays this exchange. Without this the
        // model would only ever see the most recent message.
        const { persistLocalWorkingUserMessage, persistLocalWorkingAssistantMessage } =
          await import('@/lib/copilot/local-runtime/persistence')
        await persistLocalWorkingUserMessage({
          reviewSessionId: params.reviewSessionId,
          itemId: params.userMessageId,
          text: params.message,
        })

        const result = await runLocalCopilotTurn(
          {
            model: bareModel,
            conversationId,
            userMessage: params.modelMessage,
            contexts: params.contexts ?? [],
            fileContents: params.fileContents ?? [],
            priorWorkingMessages,
            requestId: params.requestId,
            ctx: {
              userId: params.userId,
              accessLevel: 'limited',
              ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
            },
            sink: {
              send: (payload: Record<string, unknown>) => {
                const { event, ...rest } = payload as { event: string } & Record<string, unknown>
                send(event, rest)
              },
              close: () => {},
              error: () => {},
            },
          },
          {
            onAssistantToolCalls: async (message) => {
              await persistLocalWorkingMessage({
                reviewSessionId: params.reviewSessionId,
                message,
              })
            },
            onToolResult: async (message) => {
              await persistLocalWorkingMessage({
                reviewSessionId: params.reviewSessionId,
                message,
              })
            },
          }
        )

        if (result.awaiting) {
          send('awaiting_tools', {
            toolCallId: result.awaiting.toolCallId,
            toolName: result.awaiting.toolName,
          })
          send('turn_state', { status: 'in_progress', phase: 'waiting_for_tools' })
        } else {
          send('response.completed', {})
          send('turn_state', { status: 'completed', phase: 'completed' })
        }

        await persistAssistantTranscript({
          reviewSessionId: params.reviewSessionId,
          assistantMessageId,
          content: result.text,
        })

        // Mirror the assistant reply into the working history so the next turn
        // replays both sides of the exchange.
        await persistLocalWorkingAssistantMessage({
          reviewSessionId: params.reviewSessionId,
          itemId: assistantMessageId,
          text: result.text,
        })

        send('stream_end', {})
      } catch (error) {
        logger.error(`[${params.requestId}] Local copilot turn failed`, { error })
        send('error', {
          message: error instanceof Error ? error.message : 'Local copilot request failed',
        })
        send('turn_state', { status: 'error', phase: 'error' })
      } finally {
        closed = true
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

/**
 * Resumes a local turn after the browser executed a client-only tool.
 */
export async function handleLocalCopilotContinuation(
  params: LocalContinuationHandlerParams
): Promise<ReadableStream<Uint8Array>> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: Record<string, unknown> = {}) => {
        if (closed) return
        controller.enqueue(encodeSSE({ type: event, ...data }))
      }

      try {
        send('turn_state', { status: 'in_progress', phase: 'streaming' })

        const priorWorkingMessages = await loadLocalWorkingHistory(params.reviewSessionId)
        if (!priorWorkingMessages) {
          logger.warn('Local continuation without stored working history', {
            reviewSessionId: params.reviewSessionId,
          })
          send('response.completed', {})
          send('turn_state', { status: 'completed', phase: 'completed' })
          send('stream_end', {})
          return
        }

        const result = await runLocalCopilotTurn(
          {
            model: params.model,
            conversationId: params.reviewSessionId,
            userMessage: '',
            contexts: [],
            priorWorkingMessages,
            continuation: params.continuation,
            requestId: params.requestId,
            ctx: {
              userId: params.userId,
              accessLevel: 'limited',
            },
            sink: {
              send: (payload: Record<string, unknown>) => {
                const { event, ...rest } = payload as { event: string } & Record<string, unknown>
                send(event, rest)
              },
              close: () => {},
              error: () => {},
            },
          },
          {
            onAssistantToolCalls: async (message) => {
              await persistLocalWorkingMessage({
                reviewSessionId: params.reviewSessionId,
                message,
              })
            },
            onToolResult: async (message) => {
              await persistLocalWorkingMessage({
                reviewSessionId: params.reviewSessionId,
                message,
              })
            },
          }
        )

        if (result.awaiting) {
          send('awaiting_tools', {
            toolCallId: result.awaiting.toolCallId,
            toolName: result.awaiting.toolName,
          })
          send('turn_state', { status: 'in_progress', phase: 'waiting_for_tools' })
        } else {
          send('response.completed', {})
          send('turn_state', { status: 'completed', phase: 'completed' })
        }

        await persistLocalContinuationText(params.reviewSessionId, result.text)

        send('stream_end', {})
      } catch (error) {
        logger.error(`[${params.requestId}] Local copilot continuation failed`, { error })
        send('error', {
          message: error instanceof Error ? error.message : 'Local copilot continuation failed',
        })
        send('turn_state', { status: 'error', phase: 'error' })
      } finally {
        closed = true
        controller.close()
      }
    },
  })
}

/**
 * Appends streamed assistant text to the turn's assistant transcript item, and
 * mirrors it into the working history so the next turn replays it.
 */
async function persistLocalContinuationText(reviewSessionId: string, text: string) {
  if (!text.trim()) return
  const { appendLocalAssistantText, persistLocalWorkingAssistantMessage } = await import(
    '@/lib/copilot/local-runtime/persistence'
  )
  await appendLocalAssistantText(reviewSessionId, text)
  await persistLocalWorkingAssistantMessage({
    reviewSessionId,
    itemId: `continuation_${crypto.randomUUID()}`,
    text,
  })
}

async function loadLocalWorkingHistory(
  reviewSessionId: string
): Promise<LocalWorkingMessage[] | null> {
  const { loadLocalWorkingMessages } = await import('@/lib/copilot/local-runtime/persistence')
  return loadLocalWorkingMessages(reviewSessionId)
}
