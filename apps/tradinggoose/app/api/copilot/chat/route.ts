import { db } from '@tradinggoose/db'
import {
  copilotReviewItems,
  copilotReviewSessions,
  copilotReviewTurns,
} from '@tradinggoose/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { requestCopilotTitle } from '@/lib/copilot/agent/utils'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { normalizeFunctionCallArguments } from '@/lib/copilot/function-call-args'
import {
  mapSessionToApiResponse,
  SESSION_SELECT_COLUMNS,
} from '@/lib/copilot/review-sessions/api-mapping'
import { loadReviewSessionForUser } from '@/lib/copilot/review-sessions/permissions'
import {
  buildAppendReviewTurn,
  deriveReviewTurnsAndItems,
  MESSAGE_ROLES,
  mapReviewItemToApi,
  REVIEW_ITEM_KINDS,
  type ReviewMessageApi,
  type ReviewMessageInput,
  type ReviewTurnStatus,
} from '@/lib/copilot/review-sessions/thread-history'
import { COPILOT_RUNTIME_MODELS, DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'
import { COPILOT_RUNTIME_PROVIDER_IDS } from '@/lib/copilot/runtime-provider'
import { buildCopilotRuntimeProviderConfig } from '@/lib/copilot/runtime-provider.server'
import {
  COPILOT_RUNTIME_CONFIG_PLACEHOLDER,
  COPILOT_SESSION_KIND,
} from '@/lib/copilot/session-scope'
import { createLogger } from '@/lib/logs/console/logger'
import { CopilotFiles } from '@/lib/uploads'
import { createFileContent } from '@/lib/uploads/utils/file-utils'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'
import type { ProviderId } from '@/providers/ai/types'

const logger = createLogger('CopilotChatAPI')

type ReviewSessionRow = Parameters<typeof mapSessionToApiResponse>[0]

/** Domain objects attached to a persisted chat message. */
interface PersistMessageAttachments {
  fileAttachments?: ReviewMessageInput['fileAttachments']
  contexts?: ReviewMessageInput['contexts']
  toolCalls?: ReviewMessageInput['toolCalls']
  contentBlocks?: ReviewMessageInput['contentBlocks']
}

interface PersistChatMessagesResult {
  savedUserMessage: boolean
  savedAssistantMessage: boolean
}

type StreamAssistantItemState = {
  id: string
  order: number
  timestamp: number
  provisionalText: string
  finalText: string | null
}

type StreamFunctionCallState = {
  id: string
  order: number
  timestamp: number
  name: string
  arguments?: Record<string, unknown>
  state: 'pending' | 'success' | 'error' | 'rejected'
  result?: unknown
}

type StreamReasoningItemState = {
  id: string
  order: number
  timestamp: number
  startTime: number
  provisionalText: string
  finalText: string | null
  duration?: number
}

async function lockReviewSessionForHistoryMutation(tx: any, reviewSessionId: string) {
  await tx
    .update(copilotReviewSessions)
    .set({
      updatedAt: new Date(),
    })
    .where(eq(copilotReviewSessions.id, reviewSessionId))
}

function getPersistedReviewMessageId(message: ReviewMessageApi | Record<string, unknown>): string {
  if (typeof message.id === 'string') {
    return message.id
  }

  const itemId = (message as Record<string, unknown>).itemId
  if (typeof itemId === 'string') {
    return itemId
  }

  return ''
}

// Generic copilot chats are grouped by workspace for history lists. Creating a
// new generic chat inserts a fresh session unless a specific reviewSessionId is
// explicitly supplied by the client.

/**
 * Persists user + assistant messages and updates the review session in a single transaction.
 * Shared between the streaming and non-streaming response paths.
 */
async function persistChatMessages(
  params: {
    reviewSessionId: string
    userMessageId: string
    userContent: string
    assistantContent: string | null
    timestamp: string
    conversationId?: string
    latestTurnStatus?: ReviewTurnStatus
  } & PersistMessageAttachments
): Promise<PersistChatMessagesResult> {
  const hasAssistantMessage =
    (typeof params.assistantContent === 'string' && params.assistantContent.trim().length > 0) ||
    (Array.isArray(params.toolCalls) && params.toolCalls.length > 0) ||
    (Array.isArray(params.contentBlocks) && params.contentBlocks.length > 0)

  await db.transaction(async (tx) => {
    // Serialize history mutations per review session. The stream route appends
    // here while the client may also POST `/update-messages` immediately after
    // the SSE `done` event, so both paths need to contend on the same row lock.
    await lockReviewSessionForHistoryMutation(tx, params.reviewSessionId)

    const currentItems = await tx
      .select()
      .from(copilotReviewItems)
      .where(
        and(
          eq(copilotReviewItems.sessionId, params.reviewSessionId),
          eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
        )
      )
      .orderBy(asc(copilotReviewItems.sequence))
    const currentMessages = currentItems.map(mapReviewItemToApi)
    const hasPersistedUserMessage = currentMessages.some(
      (message) => getPersistedReviewMessageId(message) === params.userMessageId
    )

    const assistantMessage = hasAssistantMessage
      ? {
          id: crypto.randomUUID(),
          role: MESSAGE_ROLES.ASSISTANT,
          content: params.assistantContent ?? '',
          timestamp: params.timestamp,
          toolCalls: params.toolCalls,
          contentBlocks: params.contentBlocks,
        }
      : null

    if (hasPersistedUserMessage) {
      const userMessageIndex = currentMessages.findIndex(
        (message) => getPersistedReviewMessageId(message) === params.userMessageId
      )
      const nextUserTurnBoundary = currentMessages.findIndex(
        (message, index) => index > userMessageIndex && message.role === MESSAGE_ROLES.USER
      )
      const trailingMessages =
        nextUserTurnBoundary === -1
          ? []
          : (currentMessages.slice(nextUserTurnBoundary) as ReviewMessageInput[])

      const nextMessages: ReviewMessageInput[] = [
        ...(currentMessages.slice(0, userMessageIndex) as ReviewMessageInput[]),
        {
          id: params.userMessageId,
          role: MESSAGE_ROLES.USER,
          content: params.userContent,
          timestamp: params.timestamp,
          fileAttachments: params.fileAttachments,
          contexts: params.contexts,
        },
        ...(assistantMessage ? [assistantMessage] : []),
        ...trailingMessages,
      ]

      const nextHistory = deriveReviewTurnsAndItems(
        params.reviewSessionId,
        nextMessages,
        params.latestTurnStatus ?? 'completed'
      )

      await tx
        .delete(copilotReviewItems)
        .where(eq(copilotReviewItems.sessionId, params.reviewSessionId))
      await tx
        .delete(copilotReviewTurns)
        .where(eq(copilotReviewTurns.sessionId, params.reviewSessionId))

      if (nextHistory.turns.length > 0) {
        await tx.insert(copilotReviewTurns).values(nextHistory.turns)
      }

      if (nextHistory.items.length > 0) {
        await tx.insert(copilotReviewItems).values(nextHistory.items)
      }

      await tx
        .update(copilotReviewSessions)
        .set({
          updatedAt: new Date(),
          ...(params.conversationId ? { conversationId: params.conversationId } : {}),
        })
        .where(eq(copilotReviewSessions.id, params.reviewSessionId))
      return
    }

    const nextTurn = buildAppendReviewTurn({
      reviewSessionId: params.reviewSessionId,
      existingMessages: currentMessages,
      userMessage: {
        id: params.userMessageId,
        role: MESSAGE_ROLES.USER,
        content: params.userContent,
        timestamp: params.timestamp,
        fileAttachments: params.fileAttachments,
        contexts: params.contexts,
      },
      assistantMessage,
      latestTurnStatus: params.latestTurnStatus ?? 'completed',
    })

    await tx.insert(copilotReviewTurns).values(nextTurn.turn)
    await tx.insert(copilotReviewItems).values(nextTurn.items)

    await tx
      .update(copilotReviewSessions)
      .set({
        updatedAt: new Date(),
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      })
      .where(eq(copilotReviewSessions.id, params.reviewSessionId))
  })

  return {
    savedUserMessage: true,
    savedAssistantMessage: hasAssistantMessage,
  }
}

/**
 * Generates a title for a new review session and persists it.
 * Optionally invokes a callback (e.g. to emit an SSE event) when the title is ready.
 */
function generateAndPersistTitle(params: {
  reviewSessionId: string
  message: string
  model: string
  provider?: ProviderId
  requestId: string
  onTitle?: (title: string) => void
}): void {
  requestCopilotTitle({
    message: params.message,
    model: params.model,
    provider: params.provider,
  })
    .then(async (title) => {
      if (title) {
        await db
          .update(copilotReviewSessions)
          .set({
            title,
            updatedAt: new Date(),
          })
          .where(eq(copilotReviewSessions.id, params.reviewSessionId))

        params.onTitle?.(title)
        logger.info(`[${params.requestId}] Generated and saved title: ${title}`)
      }
    })
    .catch((error) => {
      logger.error(`[${params.requestId}] Title generation failed:`, error)
    })
}

const getOutputItemText = (
  item: Record<string, unknown>,
  expectedType: 'output_text' | 'reasoning_text'
): string => {
  const content = Array.isArray(item.content) ? item.content : []
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue
    const typedEntry = entry as Record<string, unknown>
    if (typedEntry.type === expectedType && typeof typedEntry.text === 'string') {
      return typedEntry.text
    }
  }
  return ''
}

const createCopilotStreamCapture = () => {
  const assistantItems = new Map<string, StreamAssistantItemState>()
  const reasoningItems = new Map<string, StreamReasoningItemState>()
  const functionCalls = new Map<string, StreamFunctionCallState>()
  let itemOrder = 0

  const nextOrder = () => itemOrder++

  const ensureAssistantItem = (itemId: string) => {
    let item = assistantItems.get(itemId)
    if (!item) {
      item = {
        id: itemId,
        order: nextOrder(),
        timestamp: Date.now(),
        provisionalText: '',
        finalText: null,
      }
      assistantItems.set(itemId, item)
    }
    return item
  }

  const ensureReasoningItem = (itemId: string) => {
    let item = reasoningItems.get(itemId)
    if (!item) {
      const startTime = Date.now()
      item = {
        id: itemId,
        order: nextOrder(),
        timestamp: startTime,
        startTime,
        provisionalText: '',
        finalText: null,
      }
      reasoningItems.set(itemId, item)
    }
    return item
  }

  const ensureFunctionCall = (
    callId: string,
    options?: {
      name?: string
      arguments?: Record<string, unknown>
    }
  ) => {
    let item = functionCalls.get(callId)
    if (!item) {
      item = {
        id: callId,
        order: nextOrder(),
        timestamp: Date.now(),
        name: options?.name ?? '',
        arguments: options?.arguments,
        state: 'pending',
      }
      functionCalls.set(callId, item)
      return item
    }

    if (options?.name) {
      item.name = options.name
    }
    if (options?.arguments) {
      item.arguments = options.arguments
    }
    return item
  }

  const buildPersistedToolCall = (toolCall: StreamFunctionCallState) => ({
    id: toolCall.id,
    name: toolCall.name,
    state: toolCall.state,
    ...(toolCall.arguments ? { arguments: toolCall.arguments, params: toolCall.arguments } : {}),
    ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
  })

  return {
    captureAddedItem(item: Record<string, unknown>) {
      if (item.type === 'message' && item.role === 'assistant') {
        const itemId = typeof item.id === 'string' ? item.id : ''
        if (!itemId) return
        const state = ensureAssistantItem(itemId)
        const initialText = getOutputItemText(item, 'output_text')
        if (initialText && state.provisionalText.length === 0 && state.finalText === null) {
          state.provisionalText = initialText
        }
        return
      }

      if (item.type === 'reasoning') {
        const itemId = typeof item.id === 'string' ? item.id : ''
        if (!itemId) return
        const state = ensureReasoningItem(itemId)
        const initialText = getOutputItemText(item, 'reasoning_text')
        if (initialText && state.provisionalText.length === 0 && state.finalText === null) {
          state.provisionalText = initialText
        }
      }
    },
    captureTextDelta(itemId: string, delta: string) {
      if (!itemId || !delta) return
      const state = ensureAssistantItem(itemId)
      state.provisionalText += delta
    },
    captureReasoningDelta(itemId: string, delta: string) {
      if (!itemId || !delta) return
      const state = ensureReasoningItem(itemId)
      state.provisionalText += delta
    },
    captureDoneItem(item: Record<string, unknown>) {
      if (item.type === 'message' && item.role === 'assistant') {
        const itemId = typeof item.id === 'string' ? item.id : ''
        if (!itemId) return
        const state = ensureAssistantItem(itemId)
        state.finalText = getOutputItemText(item, 'output_text')
        return
      }

      if (item.type === 'reasoning') {
        const itemId = typeof item.id === 'string' ? item.id : ''
        if (!itemId) return
        const state = ensureReasoningItem(itemId)
        state.finalText = getOutputItemText(item, 'reasoning_text')
        state.duration = Date.now() - state.startTime
        return
      }

      if (item.type === 'function_call') {
        const callId = typeof item.call_id === 'string' ? item.call_id : ''
        const name = typeof item.name === 'string' ? item.name : ''
        if (!callId || !name) return
        const args = normalizeFunctionCallArguments(item.arguments)
        ensureFunctionCall(callId, {
          name,
          ...(args ? { arguments: args } : {}),
        })
      }
    },
    captureToolResult(event: Record<string, unknown>) {
      const toolCallId =
        typeof event.toolCallId === 'string'
          ? event.toolCallId
          : typeof (event.data as Record<string, unknown> | undefined)?.id === 'string'
            ? ((event.data as Record<string, unknown>).id as string)
            : ''
      if (!toolCallId) return

      const toolName = typeof event.toolName === 'string' ? event.toolName : undefined
      const current = ensureFunctionCall(toolCallId, { name: toolName })
      const success = event.success === true
      const failedDependency = event.failedDependency === true
      const skipped =
        event.result &&
        typeof event.result === 'object' &&
        (event.result as Record<string, unknown>).skipped === true

      current.state = success ? 'success' : failedDependency || skipped ? 'rejected' : 'error'
      if ('result' in event) {
        current.result = event.result
      }
    },
    captureToolError(event: Record<string, unknown>) {
      const toolCallId =
        typeof event.toolCallId === 'string'
          ? event.toolCallId
          : typeof (event.data as Record<string, unknown> | undefined)?.id === 'string'
            ? ((event.data as Record<string, unknown>).id as string)
            : ''
      if (!toolCallId) return

      const toolName = typeof event.toolName === 'string' ? event.toolName : undefined
      const current = ensureFunctionCall(toolCallId, { name: toolName })
      current.state = event.failedDependency === true ? 'rejected' : 'error'
      current.result = {
        success: false,
        ...(typeof event.error === 'string' ? { error: event.error } : {}),
      }
    },
    buildAssistantContent() {
      return Array.from(assistantItems.values())
        .sort((a, b) => a.order - b.order)
        .map((item) => item.finalText ?? item.provisionalText)
        .join('')
    },
    buildToolCalls() {
      return Array.from(functionCalls.values())
        .sort((a, b) => a.order - b.order)
        .filter((toolCall) => toolCall.name.length > 0)
        .map(buildPersistedToolCall)
    },
    buildContentBlocks() {
      const now = Date.now()
      const textBlocks = Array.from(assistantItems.values())
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          type: 'text' as const,
          content: item.finalText ?? item.provisionalText,
          timestamp: item.timestamp,
          itemId: item.id,
          order: item.order,
        }))
        .filter((item) => item.content.trim().length > 0)

      const thinkingBlocks = Array.from(reasoningItems.values())
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          type: 'thinking' as const,
          content: item.finalText ?? item.provisionalText,
          timestamp: item.timestamp,
          itemId: item.id,
          startTime: item.startTime,
          duration: item.duration ?? Math.max(0, now - item.startTime),
          order: item.order,
        }))
        .filter((item) => item.content.trim().length > 0)

      const toolBlocks = Array.from(functionCalls.values())
        .sort((a, b) => a.order - b.order)
        .filter((toolCall) => toolCall.name.length > 0)
        .map((toolCall) => ({
          type: 'tool_call' as const,
          timestamp: toolCall.timestamp,
          toolCall: buildPersistedToolCall(toolCall),
          order: toolCall.order,
        }))

      return [...textBlocks, ...thinkingBlocks, ...toolBlocks]
        .sort((a, b) => a.order - b.order)
        .map(({ order: _order, ...block }) => block)
    },
  }
}

/**
 * Extracts a user-facing message from an SSE error event, wraps it in italics,
 * and enqueues a synthetic assistant item lifecycle onto the stream.
 * Returns the formatted assistant content string so the caller can persist it.
 */
function enqueueErrorRewrite(
  event: Record<string, unknown>,
  controller: ReadableStreamDefaultController,
  reader: ReadableStreamDefaultReader
): string {
  const eventData =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>)
      : null
  const displayMessage: string =
    (typeof eventData?.displayMessage === 'string' && eventData.displayMessage) ||
    (typeof event.error === 'string' && event.error) ||
    (typeof event.data === 'string' && event.data) ||
    'Sorry, I encountered an error. Please try again.'
  const formatted = `_${displayMessage}_`
  const itemId = `error-${crypto.randomUUID()}`
  try {
    controller.enqueue(
      encodeSSE({
        type: 'response.output_item.added',
        item: {
          id: itemId,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '' }],
        },
      })
    )
  } catch {
    reader.cancel()
    return formatted
  }
  try {
    controller.enqueue(
      encodeSSE({
        type: 'response.output_text.delta',
        item_id: itemId,
        delta: formatted,
      })
    )
    controller.enqueue(
      encodeSSE({
        type: 'response.output_item.done',
        item: {
          id: itemId,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: formatted }],
        },
      })
    )
    controller.enqueue(
      encodeSSE({
        type: 'response.completed',
        response: { id: itemId },
      })
    )
  } catch {
    reader.cancel()
  }
  return formatted
}

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(), // ID from frontend for the user message
  reviewSessionId: z.string().optional(),
  model: z.enum(COPILOT_RUNTIME_MODELS).optional().default(DEFAULT_COPILOT_RUNTIME_MODEL),
  prefetch: z.boolean().optional(),
  stream: z.boolean().optional().default(true),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  provider: z.enum(COPILOT_RUNTIME_PROVIDER_IDS).optional(),
  conversationId: z.string().optional(),
  workspaceId: z.string().optional(),
  contexts: z
    .array(
      z.object({
        kind: z.enum([
          'past_chat',
          'workflow',
          'current_workflow',
          'skill',
          'current_skill',
          'indicator',
          'current_indicator',
          'custom_tool',
          'current_custom_tool',
          'mcp_server',
          'current_mcp_server',
          'blocks',
          'logs',
          'workflow_block',
          'knowledge',
          'templates',
          'docs',
        ]),
        label: z.string(),
        reviewSessionId: z.string().optional(),
        workflowId: z.string().optional(),
        skillId: z.string().optional(),
        indicatorId: z.string().optional(),
        customToolId: z.string().optional(),
        mcpServerId: z.string().optional(),
        workspaceId: z.string().optional(),
        blockIds: z.array(z.string()).optional(),
        knowledgeId: z.string().optional(),
        blockId: z.string().optional(),
        templateId: z.string().optional(),
        executionId: z.string().optional(),
        draftSessionId: z.string().optional(),
        // For workflow_block, provide both workflowId and blockId
      })
    )
    .optional(),
})

/** POST /api/copilot/chat */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  const upstreamAbortController = new AbortController()
  const abortUpstream = () => {
    if (!upstreamAbortController.signal.aborted) {
      upstreamAbortController.abort()
    }
  }

  if (req.signal.aborted) {
    abortUpstream()
  } else {
    req.signal.addEventListener('abort', abortUpstream, { once: true })
  }

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const authenticatedUserId = session.user.id

    const body = await req.json()
    const {
      message,
      userMessageId,
      reviewSessionId: incomingReviewSessionId,
      model,
      prefetch,
      stream,
      fileAttachments,
      provider,
      conversationId,
      workspaceId: incomingWorkspaceId,
      contexts,
    } = ChatMessageSchema.parse(body)
    const userMessageIdToUse = userMessageId || crypto.randomUUID()
    try {
      logger.info(`[${tracker.requestId}] Received chat POST`, {
        hasContexts: Array.isArray(contexts),
        contextsCount: Array.isArray(contexts) ? contexts.length : 0,
        contextsPreview: Array.isArray(contexts)
          ? contexts.map((c: any) => ({
              kind: c?.kind,
              reviewSessionId: c?.reviewSessionId,
              workflowId: c?.workflowId,
              executionId: (c as any)?.executionId,
              label: c?.label,
            }))
          : undefined,
      })
    } catch {}
    let agentContexts: Array<{ type: string; content: string }> = []
    if (Array.isArray(contexts) && contexts.length > 0) {
      try {
        const { processContextsServer } = await import('@/lib/copilot/process-contents')
        const processed = await processContextsServer(
          contexts as any,
          authenticatedUserId,
          message,
          incomingWorkspaceId
        )
        agentContexts = processed
        logger.info(`[${tracker.requestId}] Contexts processed for request`, {
          processedCount: agentContexts.length,
          kinds: agentContexts.map((c) => c.type),
          lengthPreview: agentContexts.map((c) => c.content?.length ?? 0),
        })
        if (Array.isArray(contexts) && contexts.length > 0 && agentContexts.length === 0) {
          logger.warn(
            `[${tracker.requestId}] Contexts provided but none processed. Check executionId for logs contexts.`
          )
        }
      } catch (e) {
        logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
      }
    }

    // Start file attachment processing early so it runs in parallel with session loading/creation
    const fileProcessingPromise =
      fileAttachments && fileAttachments.length > 0
        ? CopilotFiles.processCopilotAttachments(fileAttachments, tracker.requestId)
        : null

    let currentSession: ReviewSessionRow | null = null
    let conversationHistory: ReviewMessageApi[] = []
    let actualReviewSessionId = incomingReviewSessionId
    let sessionCreatedThisRequest = false

    if (incomingReviewSessionId) {
      const session = await loadReviewSessionForUser(incomingReviewSessionId, authenticatedUserId)
      if (!session || session.entityKind !== COPILOT_SESSION_KIND) {
        return createNotFoundResponse('Review session not found or unauthorized')
      }

      currentSession = session

      const existingMessages = await db
        .select()
        .from(copilotReviewItems)
        .where(
          and(
            eq(copilotReviewItems.sessionId, incomingReviewSessionId),
            eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
          )
        )
        .orderBy(asc(copilotReviewItems.sequence))

      conversationHistory = existingMessages.map(mapReviewItemToApi)
    } else {
      if (!model || typeof model !== 'string') {
        return createBadRequestResponse('model is required when creating a new review session')
      }
      const [newSession] = await db
        .insert(copilotReviewSessions)
        .values({
          userId: authenticatedUserId,
          entityKind: COPILOT_SESSION_KIND,
          entityId: null,
          workspaceId: incomingWorkspaceId || null,
          draftSessionId: null,
          title: null,
          model: COPILOT_RUNTIME_CONFIG_PLACEHOLDER,
        })
        .returning(SESSION_SELECT_COLUMNS)

      if (newSession) {
        currentSession = newSession
        actualReviewSessionId = newSession.id
        sessionCreatedThisRequest = true
      }
    }

    const processedFileContents: any[] = []
    if (fileProcessingPromise) {
      const processedAttachments = await fileProcessingPromise

      for (const { buffer, attachment } of processedAttachments) {
        const fileContent = createFileContent(buffer, attachment.media_type)
        if (fileContent) {
          processedFileContents.push(fileContent)
        }
      }
    }

    const { provider: runtimeProvider, providerConfig } = await buildCopilotRuntimeProviderConfig({
      model,
      provider,
    })

    const effectiveConversationId =
      (currentSession?.conversationId as string | undefined) || conversationId

    const { getCopilotRuntimeToolManifest } = await import('@/lib/copilot/runtime-tool-manifest')

    const requestPayload = {
      message: message, // Just send the current user message text
      userId: authenticatedUserId,
      stream: stream,
      streamToolCalls: true,
      model: model,
      messageId: userMessageIdToUse,
      ...(providerConfig ? { provider: providerConfig } : {}),
      ...(effectiveConversationId ? { conversationId: effectiveConversationId } : {}),
      ...(typeof prefetch === 'boolean' ? { prefetch: prefetch } : {}),
      ...(session?.user?.name && { userName: session.user.name }),
      ...(agentContexts.length > 0 && { context: agentContexts }),
      ...(actualReviewSessionId ? { chatId: actualReviewSessionId } : {}),
      toolManifest: await getCopilotRuntimeToolManifest(),
      ...(processedFileContents.length > 0 && { fileAttachments: processedFileContents }),
    }

    try {
      logger.info(`[${tracker.requestId}] About to call TradingGoose Copilot`, {
        hasContext: agentContexts.length > 0,
        contextCount: agentContexts.length,
        hasConversationId: !!effectiveConversationId,
        hasFileAttachments: processedFileContents.length > 0,
        messageLength: message.length,
      })
    } catch {}

    const copilotResponse = await proxyCopilotRequest({
      endpoint: '/api/copilot',
      body: requestPayload,
      signal: upstreamAbortController.signal,
    })

    if (!copilotResponse.ok) {
      if (copilotResponse.status === 401 || copilotResponse.status === 402) {
        // Rethrow status only; client will render appropriate assistant message
        return new NextResponse(null, { status: copilotResponse.status })
      }

      const errorText = await copilotResponse.text().catch(() => '')
      logger.error(`[${tracker.requestId}] TradingGoose Copilot API error:`, {
        status: copilotResponse.status,
        error: errorText,
      })

      return NextResponse.json(
        { error: `TradingGoose Copilot API error: ${copilotResponse.statusText}` },
        { status: copilotResponse.status }
      )
    }

    if (stream && copilotResponse.body) {
      const userMessage = {
        id: userMessageIdToUse, // Consistent ID used for request and persistence
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
        ...(Array.isArray(contexts) && contexts.length > 0 && { contexts }),
        ...(Array.isArray(contexts) &&
          contexts.length > 0 && {
            contentBlocks: [{ type: 'contexts', contexts: contexts as any, timestamp: Date.now() }],
          }),
      }

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
      const transformedStream = new ReadableStream({
        async start(controller) {
          let assistantContentOverride: string | null = null
          const streamCapture = createCopilotStreamCapture()
          let buffer = ''
          let conversationIdFromStart: string | undefined
          let latestTurnStatus: ReviewTurnStatus = 'completed'
          const shouldGenerateTitle =
            actualReviewSessionId && !currentSession?.title && conversationHistory.length === 0
          let titleRequested = false
          let persistedMessages: PersistChatMessagesResult = {
            savedUserMessage: false,
            savedAssistantMessage: false,
          }

          if (actualReviewSessionId) {
            controller.enqueue(
              encodeSSE({
                type: 'review_session_id',
                reviewSessionId: actualReviewSessionId,
              })
            )
            logger.debug(`[${tracker.requestId}] Sent initial reviewSessionId event to client`)
          }

          reader = copilotResponse.body!.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
              if (upstreamAbortController.signal.aborted || req.signal.aborted) {
                break
              }

              const { done, value } = await reader.read()
              if (done) {
                break
              }

              const decodedChunk = decoder.decode(value, { stream: true })
              buffer += decodedChunk

              const lines = buffer.split('\n')
              buffer = lines.pop() || '' // Keep incomplete line in buffer

              for (const line of lines) {
                if (line.trim() === '') continue // Skip empty lines

                if (line.startsWith('data: ') && line.length > 6) {
                  try {
                    const jsonStr = line.slice(6)

                    // Check if the JSON string is unusually large (potential streaming issue)
                    if (jsonStr.length > 50000) {
                      // 50KB limit
                      logger.warn(`[${tracker.requestId}] Large SSE event detected`, {
                        size: jsonStr.length,
                        preview: `${jsonStr.substring(0, 100)}...`,
                      })
                    }

                    const event = JSON.parse(jsonStr)

                    switch (event.type) {
                      case 'tool_result':
                        streamCapture.captureToolResult(event as Record<string, unknown>)
                        break

                      case 'tool_error':
                        streamCapture.captureToolError(event as Record<string, unknown>)
                        logger.error(`[${tracker.requestId}] Tool error:`, {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          error: event.error,
                          success: event.success,
                        })
                        break

                      case 'start':
                        if (
                          typeof event.data?.conversationId === 'string' &&
                          event.data.conversationId.length > 0
                        ) {
                          conversationIdFromStart = event.data.conversationId
                        }
                        if (
                          shouldGenerateTitle &&
                          !titleRequested &&
                          typeof event.data?.conversationId === 'string' &&
                          event.data.conversationId.length > 0
                        ) {
                          titleRequested = true
                          generateAndPersistTitle({
                            reviewSessionId: actualReviewSessionId!,
                            message,
                            model,
                            provider: runtimeProvider,
                            requestId: tracker.requestId,
                            onTitle: (title) => {
                              controller.enqueue(
                                encodeSSE({
                                  type: 'title_updated',
                                  title,
                                })
                              )
                            },
                          })
                        }
                        break

                      case 'response.output_item.added':
                        if (event.item && typeof event.item === 'object') {
                          streamCapture.captureAddedItem(event.item as Record<string, unknown>)
                        }
                        break

                      case 'response.output_text.delta':
                        if (typeof event.item_id === 'string' && typeof event.delta === 'string') {
                          streamCapture.captureTextDelta(event.item_id, event.delta)
                        }
                        break

                      case 'response.reasoning_text.delta':
                        if (typeof event.item_id === 'string' && typeof event.delta === 'string') {
                          streamCapture.captureReasoningDelta(event.item_id, event.delta)
                        }
                        logger.debug(
                          `[${tracker.requestId}] Reasoning chunk received (${(event.delta || '').length} chars)`
                        )
                        break

                      case 'response.output_item.done':
                        if (event.item && typeof event.item === 'object') {
                          streamCapture.captureDoneItem(event.item as Record<string, unknown>)
                        }
                        break

                      case 'response.completed':
                        break

                      case 'awaiting_tools':
                        latestTurnStatus = 'in_progress'
                        break

                      case 'error':
                        break

                      default:
                    }

                    if (event?.type === 'error') {
                      assistantContentOverride = enqueueErrorRewrite(event, controller, reader)
                    } else {
                      try {
                        controller.enqueue(encodeSSE(event))
                      } catch (enqueueErr) {
                        reader.cancel()
                        break
                      }
                    }
                  } catch (e) {
                    // Enhanced error handling for large payloads and parsing issues
                    const lineLength = line.length
                    const isLargePayload = lineLength > 10000

                    if (isLargePayload) {
                      logger.error(
                        `[${tracker.requestId}] Failed to parse large SSE event (${lineLength} chars)`,
                        {
                          error: e,
                          preview: `${line.substring(0, 200)}...`,
                          size: lineLength,
                        }
                      )
                    } else {
                      logger.warn(
                        `[${tracker.requestId}] Failed to parse SSE event: "${line.substring(0, 200)}..."`,
                        e
                      )
                    }
                  }
                } else if (line.trim() && line !== 'data: [DONE]') {
                  logger.debug(`[${tracker.requestId}] Non-SSE line from Copilot: "${line}"`)
                }
              }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
              logger.debug(`[${tracker.requestId}] Processing remaining buffer: "${buffer}"`)
              if (buffer.startsWith('data: ')) {
                try {
                  const jsonStr = buffer.slice(6)
                  const event = JSON.parse(jsonStr)
                  if (event.type === 'tool_result') {
                    streamCapture.captureToolResult(event as Record<string, unknown>)
                  }
                  if (event.type === 'tool_error') {
                    streamCapture.captureToolError(event as Record<string, unknown>)
                  }
                  if (event.type === 'response.output_item.added' && event.item) {
                    streamCapture.captureAddedItem(event.item as Record<string, unknown>)
                  }
                  if (
                    event.type === 'response.output_text.delta' &&
                    typeof event.item_id === 'string' &&
                    typeof event.delta === 'string'
                  ) {
                    streamCapture.captureTextDelta(event.item_id, event.delta)
                  }
                  if (
                    event.type === 'response.reasoning_text.delta' &&
                    typeof event.item_id === 'string' &&
                    typeof event.delta === 'string'
                  ) {
                    streamCapture.captureReasoningDelta(event.item_id, event.delta)
                  }
                  if (event.type === 'response.output_item.done' && event.item) {
                    streamCapture.captureDoneItem(event.item as Record<string, unknown>)
                  }
                  if (event?.type === 'error') {
                    assistantContentOverride = enqueueErrorRewrite(event, controller, reader)
                  } else {
                    try {
                      controller.enqueue(encodeSSE(event))
                    } catch (enqueueErr) {
                      reader.cancel()
                    }
                  }
                } catch (e) {
                  logger.warn(`[${tracker.requestId}] Failed to parse final buffer: "${buffer}"`)
                }
              }
            }

            // Log final streaming summary
            const assistantContent =
              assistantContentOverride ?? streamCapture.buildAssistantContent()
            const toolCalls = streamCapture.buildToolCalls()
            const contentBlocks = streamCapture.buildContentBlocks()
            logger.info(`[${tracker.requestId}] Streaming complete summary:`, {
              totalContentLength: assistantContent.length,
              toolCallsCount: toolCalls.length,
              contentBlocksCount: contentBlocks.length,
              hasContent: assistantContent.length > 0,
              toolNames: toolCalls.map((tc) => tc?.name).filter(Boolean),
            })

            if (currentSession) {
              const now = new Date().toISOString()
              const conversationIdToPersist =
                conversationIdFromStart || (currentSession?.conversationId ?? undefined)

              persistedMessages = await persistChatMessages({
                reviewSessionId: actualReviewSessionId!,
                userMessageId: userMessage.id as string,
                userContent: message,
                assistantContent,
                timestamp: now,
                conversationId: conversationIdToPersist,
                fileAttachments:
                  fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
                contexts: Array.isArray(contexts) && contexts.length > 0 ? contexts : undefined,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
                latestTurnStatus,
              })

              logger.info(
                `[${tracker.requestId}] Updated review session ${actualReviewSessionId} with new messages`,
                {
                  savedUserMessage: persistedMessages.savedUserMessage,
                  savedAssistantMessage: persistedMessages.savedAssistantMessage,
                  updatedConversationId: conversationIdToPersist || null,
                }
              )
            }

            if (sessionCreatedThisRequest && !persistedMessages.savedUserMessage) {
              try {
                await db
                  .delete(copilotReviewSessions)
                  .where(eq(copilotReviewSessions.id, actualReviewSessionId!))
                logger.info(
                  `[${tracker.requestId}] Cleaned up empty review session ${actualReviewSessionId}`
                )
              } catch (cleanupErr) {
                logger.error(
                  `[${tracker.requestId}] Failed to clean up empty review session`,
                  cleanupErr
                )
              }
            }
          } catch (error) {
            if (upstreamAbortController.signal.aborted || req.signal.aborted) {
              logger.info(`[${tracker.requestId}] Copilot stream aborted by client disconnect`)
            } else {
              logger.error(`[${tracker.requestId}] Error processing stream:`, error)
              controller.error(error)
            }
          } finally {
            reader = null
            try {
              controller.close()
            } catch {}
          }
        },
        cancel() {
          abortUpstream()
          if (reader) {
            void reader.cancel().catch(() => {})
          }
        },
      })

      const response = new Response(transformedStream, {
        headers: SSE_HEADERS,
      })

      logger.info(`[${tracker.requestId}] Returning streaming response to client`, {
        duration: tracker.getDuration(),
        reviewSessionId: actualReviewSessionId,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })

      return response
    }

    const responseData = await copilotResponse.json()
    logger.info(`[${tracker.requestId}] Non-streaming response from Copilot:`, {
      hasContent: !!responseData.content,
      contentLength: responseData.content?.length || 0,
      model: responseData.model,
      provider: responseData.provider,
      toolCallsCount: responseData.toolCalls?.length || 0,
      hasTokens: !!responseData.tokens,
    })

    if (responseData.toolCalls?.length > 0) {
      responseData.toolCalls.forEach((toolCall: any) => {
        logger.info(`[${tracker.requestId}] Tool call in response:`, {
          id: toolCall.id,
          name: toolCall.name,
          success: toolCall.success,
          result: `${JSON.stringify(toolCall.result).substring(0, 200)}...`,
        })
      })
    }

    const toolCalls = Array.isArray(responseData.toolCalls) ? responseData.toolCalls : undefined

    if (currentSession && (responseData.content || toolCalls?.length)) {
      await persistChatMessages({
        reviewSessionId: actualReviewSessionId!,
        userMessageId: userMessageIdToUse,
        userContent: message,
        assistantContent: responseData.content,
        timestamp: new Date().toISOString(),
        fileAttachments:
          fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
        contexts: Array.isArray(contexts) && contexts.length > 0 ? contexts : undefined,
        toolCalls,
        latestTurnStatus: 'completed',
      })

      if (actualReviewSessionId && !currentSession.title && conversationHistory.length === 0) {
        logger.info(`[${tracker.requestId}] Starting title generation for non-streaming response`)
        generateAndPersistTitle({
          reviewSessionId: actualReviewSessionId,
          message,
          model: providerConfig?.model ?? model,
          provider: providerConfig?.provider,
          requestId: tracker.requestId,
        })
      }
    }

    logger.info(`[${tracker.requestId}] Returning non-streaming response`, {
      duration: tracker.getDuration(),
      reviewSessionId: actualReviewSessionId,
      responseLength: responseData.content?.length || 0,
    })

    return NextResponse.json({
      success: true,
      response: responseData,
      reviewSessionId: actualReviewSessionId,
      metadata: {
        requestId: tracker.requestId,
        message,
        duration: tracker.getDuration(),
      },
    })
  } catch (error) {
    const duration = tracker.getDuration()

    if (upstreamAbortController.signal.aborted || req.signal.aborted) {
      logger.info(`[${tracker.requestId}] Copilot chat request aborted`, {
        duration,
      })
      return new NextResponse(null, { status: 204 })
    }

    if (error instanceof z.ZodError) {
      logger.error(`[${tracker.requestId}] Validation error:`, {
        duration,
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling copilot chat:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  } finally {
    req.signal.removeEventListener('abort', abortUpstream)
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reviewSessionId = searchParams.get('reviewSessionId')
    const workspaceId = searchParams.get('workspaceId')

    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    let sessions: ReviewSessionRow[] = []

    if (reviewSessionId) {
      const session = await loadReviewSessionForUser(reviewSessionId, authenticatedUserId)

      if (!session || session.entityKind !== COPILOT_SESSION_KIND) {
        return NextResponse.json(
          { error: 'Review session not found or unauthorized' },
          { status: 404 }
        )
      }

      sessions = [session]
    } else {
      sessions = await db
        .select(SESSION_SELECT_COLUMNS)
        .from(copilotReviewSessions)
        .where(
          and(
            eq(copilotReviewSessions.userId, authenticatedUserId),
            eq(copilotReviewSessions.entityKind, COPILOT_SESSION_KIND),
            workspaceId
              ? eq(copilotReviewSessions.workspaceId, workspaceId)
              : isNull(copilotReviewSessions.workspaceId)
          )
        )
        .orderBy(desc(copilotReviewSessions.updatedAt))
    }

    const sessionIds = sessions.map((s) => s.id)
    const messagesBySession = new Map<string, ReviewMessageApi[]>()
    const latestTurnStatusBySession = new Map<string, string | null>()

    if (sessionIds.length > 0) {
      const [allMessages, allTurns] = await Promise.all([
        db
          .select()
          .from(copilotReviewItems)
          .where(
            and(
              inArray(copilotReviewItems.sessionId, sessionIds),
              eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
            )
          )
          .orderBy(asc(copilotReviewItems.sessionId), asc(copilotReviewItems.sequence)),
        db
          .select({
            sessionId: copilotReviewTurns.sessionId,
            status: copilotReviewTurns.status,
          })
          .from(copilotReviewTurns)
          .where(inArray(copilotReviewTurns.sessionId, sessionIds))
          .orderBy(asc(copilotReviewTurns.sessionId), desc(copilotReviewTurns.sequence)),
      ])

      for (const msg of allMessages) {
        const list = messagesBySession.get(msg.sessionId) ?? []
        list.push(mapReviewItemToApi(msg))
        messagesBySession.set(msg.sessionId, list)
      }

      for (const turn of allTurns) {
        if (!latestTurnStatusBySession.has(turn.sessionId)) {
          latestTurnStatusBySession.set(turn.sessionId, turn.status ?? null)
        }
      }
    }

    const transformedChats = sessions.map((session) =>
      mapSessionToApiResponse(session, {
        messageCount: messagesBySession.get(session.id)?.length ?? 0,
        messages: messagesBySession.get(session.id) ?? [],
        latestTurnStatus: latestTurnStatusBySession.get(session.id) ?? null,
      })
    )

    logger.info(
      `Retrieved ${transformedChats.length} review sessions for ${reviewSessionId ? `session ${reviewSessionId}` : `workspace ${workspaceId ?? 'global'}`}`
    )

    return NextResponse.json({
      success: true,
      chats: transformedChats,
    })
  } catch (error) {
    logger.error('Error fetching copilot review sessions:', error)
    return createInternalServerErrorResponse('Failed to fetch review sessions')
  }
}
