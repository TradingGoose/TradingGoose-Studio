import { db } from '@tradinggoose/db'
import {
  copilotReviewItems,
  copilotReviewSessions,
  copilotReviewTurns,
} from '@tradinggoose/db/schema'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { requestCopilotTitle } from '@/lib/copilot/agent/utils'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import {
  buildAppendReviewTurn,
  mapReviewItemToApi,
  MESSAGE_ROLES,
  REVIEW_ITEM_KINDS,
  type ReviewMessageApi,
  type ReviewMessageInput,
} from '@/lib/copilot/review-sessions/thread-history'
import {
  mapSessionToApiResponse,
  SESSION_SELECT_COLUMNS,
} from '@/lib/copilot/review-sessions/api-mapping'
import { loadReviewSessionForUser } from '@/lib/copilot/review-sessions/permissions'
import { ENTITY_KIND_WORKFLOW, REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import type { ProviderId } from '@/providers/ai/types'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { CopilotFiles } from '@/lib/uploads'
import { createFileContent } from '@/lib/uploads/utils/file-utils'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotChatAPI')

type ReviewSessionRow = Parameters<typeof mapSessionToApiResponse>[0]

/** Domain objects attached to a persisted chat message. */
interface PersistMessageAttachments {
  fileAttachments?: ReviewMessageInput['fileAttachments']
  contexts?: ReviewMessageInput['contexts']
  toolCalls?: ReviewMessageInput['toolCalls']
}

/**
 * Persists user + assistant messages and updates the review session in a single transaction.
 * Shared between the streaming and non-streaming response paths.
 */
async function persistChatMessages(params: {
  reviewSessionId: string
  existingMessages: ReviewMessageApi[]
  userMessageId: string
  userContent: string
  assistantContent: string | null
  timestamp: string
  conversationId?: string
} & PersistMessageAttachments): Promise<boolean> {
  const hasAssistantMessage =
    (typeof params.assistantContent === 'string' && params.assistantContent.trim().length > 0) ||
    (Array.isArray(params.toolCalls) && params.toolCalls.length > 0)

  await db.transaction(async (tx) => {
    const assistantMessage = hasAssistantMessage
      ? {
          id: crypto.randomUUID(),
          role: MESSAGE_ROLES.ASSISTANT,
          content: params.assistantContent ?? '',
          timestamp: params.timestamp,
          toolCalls: params.toolCalls,
        }
      : null

    const nextTurn = buildAppendReviewTurn({
      reviewSessionId: params.reviewSessionId,
      existingMessages: params.existingMessages,
      userMessage: {
        id: params.userMessageId,
        role: MESSAGE_ROLES.USER,
        content: params.userContent,
        timestamp: params.timestamp,
        fileAttachments: params.fileAttachments,
        contexts: params.contexts,
      },
      assistantMessage,
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

  return hasAssistantMessage
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

/**
 * Extracts a user-facing message from an SSE error event, wraps it in italics,
 * and enqueues the rewritten content + done events onto the stream.
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
  try {
    controller.enqueue(encodeSSE({ type: 'content', data: formatted }))
  } catch {
    reader.cancel()
    return formatted
  }
  try {
    controller.enqueue(encodeSSE({ type: 'done' }))
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
  workflowId: z.string().min(1).optional(),
  model: z
    .enum([
      'gpt-5-fast',
      'gpt-5',
      'gpt-5-medium',
      'gpt-5-high',
      'gpt-4o',
      'gpt-4.1',
      'o3',
      'claude-4-sonnet',
      'claude-4.5-haiku',
      'claude-4.5-sonnet',
      'claude-4.1-opus',
    ])
    .optional()
    .default('claude-4.5-sonnet'),
  prefetch: z.boolean().optional(),
  stream: z.boolean().optional().default(true),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  provider: z.string().optional().default('openai'),
  conversationId: z.string().optional(),
  entityKind: z.enum(REVIEW_ENTITY_KINDS).optional(),
  entityId: z.string().optional(),
  draftSessionId: z.string().optional(),
  workspaceId: z.string().optional(),
  contexts: z
    .array(
      z.object({
        kind: z.enum([
          'past_chat',
          'workflow',
          'current_workflow',
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
        blockIds: z.array(z.string()).optional(),
        knowledgeId: z.string().optional(),
        blockId: z.string().optional(),
        templateId: z.string().optional(),
        executionId: z.string().optional(),
        // For workflow_block, provide both workflowId and blockId
      })
    )
    .optional(),
})

/** POST /api/copilot/chat */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

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
      workflowId,
      model,
      prefetch,
      stream,
      fileAttachments,
      provider,
      conversationId,
      entityKind: incomingEntityKind,
      entityId: incomingEntityId,
      draftSessionId: incomingDraftSessionId,
      workspaceId: incomingWorkspaceId,
      contexts,
    } = ChatMessageSchema.parse(body)
    if (!incomingReviewSessionId && !workflowId) {
      return createBadRequestResponse('workflowId or reviewSessionId is required')
    }
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
        const processed = await processContextsServer(contexts as any, authenticatedUserId, message)
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

    if (incomingReviewSessionId) {
      const [session, existingMessages] = await Promise.all([
        loadReviewSessionForUser(incomingReviewSessionId, authenticatedUserId),
        db
          .select()
          .from(copilotReviewItems)
          .where(
            and(
              eq(copilotReviewItems.sessionId, incomingReviewSessionId),
              eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
            )
          )
          .orderBy(asc(copilotReviewItems.sequence)),
      ])

      if (session) {
        currentSession = session
        conversationHistory = existingMessages.map(mapReviewItemToApi)
      }
    } else if (workflowId) {
      if (!model || typeof model !== 'string') {
        return createBadRequestResponse('model is required when creating a new review session')
      }
      const [newSession] = await db
        .insert(copilotReviewSessions)
        .values({
          userId: authenticatedUserId,
          entityKind: incomingEntityKind || ENTITY_KIND_WORKFLOW,
          entityId: incomingEntityId || workflowId,
          workspaceId: incomingWorkspaceId || null,
          draftSessionId: incomingDraftSessionId || null,
          sessionScopeKey: null,
          title: null,
          model,
        })
        .returning()

      if (newSession) {
        currentSession = newSession
        actualReviewSessionId = newSession.id
      }
    }

    const wasNewlyCreated = !incomingReviewSessionId && !!currentSession

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

    const defaults = getCopilotModel('chat')
    const modelToUse = env.COPILOT_MODEL || defaults.model

    let providerConfig: CopilotProviderConfig | undefined
    const providerEnv = env.COPILOT_PROVIDER as any

    if (providerEnv) {
      if (providerEnv === 'azure-openai') {
        providerConfig = {
          provider: 'azure-openai',
          model: modelToUse,
          apiKey: env.AZURE_OPENAI_API_KEY,
          apiVersion: 'preview',
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

    const effectiveConversationId =
      (currentSession?.conversationId as string | undefined) || conversationId

    const requestPayload = {
      message: message, // Just send the current user message text
      workflowId,
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

      const transformedStream = new ReadableStream({
        async start(controller) {
          let assistantContent = ''
          const toolCalls: any[] = []
          let buffer = ''
          let conversationIdFromStart: string | undefined
          const shouldGenerateTitle =
            actualReviewSessionId && !currentSession?.title && conversationHistory.length === 0
          let titleRequested = false
          let messagesInserted = false

          if (actualReviewSessionId) {
            controller.enqueue(encodeSSE({
              type: 'review_session_id',
              reviewSessionId: actualReviewSessionId,
            }))
            logger.debug(`[${tracker.requestId}] Sent initial reviewSessionId event to client`)
          }

          const reader = copilotResponse.body!.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
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
                      case 'content':
                        if (event.data) {
                          assistantContent += event.data
                        }
                        break

                      case 'reasoning':
                        logger.debug(
                          `[${tracker.requestId}] Reasoning chunk received (${(event.data || event.content || '').length} chars)`
                        )
                        break

                      case 'tool_call':
                        if (!event.data?.partial) {
                          toolCalls.push(event.data)
                        }
                        break

                      case 'tool_generating':
                        break

                      case 'tool_result':
                        break

                      case 'tool_error':
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
                            model: providerConfig?.model ?? model,
                            provider: providerConfig?.provider,
                            requestId: tracker.requestId,
                            onTitle: (title) => {
                              controller.enqueue(encodeSSE({
                                type: 'title_updated',
                                title,
                              }))
                            },
                          })
                        }
                        break

                      case 'done':
                        break

                      case 'error':
                        break

                      default:
                    }

                    if (event?.type === 'error') {
                      assistantContent = enqueueErrorRewrite(event, controller, reader)
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
                  if (event.type === 'content' && event.data) {
                    assistantContent += event.data
                  }
                  if (event?.type === 'error') {
                    assistantContent = enqueueErrorRewrite(event, controller, reader)
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
            logger.info(`[${tracker.requestId}] Streaming complete summary:`, {
              totalContentLength: assistantContent.length,
              toolCallsCount: toolCalls.length,
              hasContent: assistantContent.length > 0,
              toolNames: toolCalls.map((tc) => tc?.name).filter(Boolean),
            })

            if (currentSession) {
              const now = new Date().toISOString()
              const conversationIdToPersist =
                conversationIdFromStart ||
                (currentSession?.conversationId ?? undefined)

              messagesInserted = await persistChatMessages({
                reviewSessionId: actualReviewSessionId!,
                existingMessages: conversationHistory,
                userMessageId: userMessage.id as string,
                userContent: message,
                assistantContent,
                timestamp: now,
                conversationId: conversationIdToPersist,
                fileAttachments:
                  fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
                contexts:
                  Array.isArray(contexts) && contexts.length > 0 ? contexts : undefined,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              })

              logger.info(
                `[${tracker.requestId}] Updated review session ${actualReviewSessionId} with new messages`,
                {
                  savedUserMessage: true,
                  savedAssistantMessage: messagesInserted,
                  updatedConversationId: conversationIdToPersist || null,
                }
              )
            }

            if (wasNewlyCreated && !messagesInserted) {
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
            logger.error(`[${tracker.requestId}] Error processing stream:`, error)
            controller.error(error)
          } finally {
            controller.close()
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

    if (currentSession && responseData.content) {
      await persistChatMessages({
        reviewSessionId: actualReviewSessionId!,
        existingMessages: conversationHistory,
        userMessageId: userMessageIdToUse,
        userContent: message,
        assistantContent: responseData.content,
        timestamp: new Date().toISOString(),
        fileAttachments:
          fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
        contexts:
          Array.isArray(contexts) && contexts.length > 0 ? contexts : undefined,
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
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const reviewSessionId = searchParams.get('reviewSessionId')

    if (!workflowId && !reviewSessionId) {
      return createBadRequestResponse('workflowId or reviewSessionId is required')
    }

    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    let sessions: ReviewSessionRow[] = []

    if (reviewSessionId) {
      const session = await loadReviewSessionForUser(reviewSessionId, authenticatedUserId)

      if (!session) {
        return NextResponse.json({ error: 'Review session not found or unauthorized' }, { status: 404 })
      }

      sessions = [session]
    } else {
      const conditions = [
        eq(copilotReviewSessions.userId, authenticatedUserId),
        eq(copilotReviewSessions.entityKind, ENTITY_KIND_WORKFLOW),
        eq(copilotReviewSessions.entityId, workflowId!),
      ]

      sessions = await db
        .select(SESSION_SELECT_COLUMNS)
        .from(copilotReviewSessions)
        .where(and(...conditions))
        .orderBy(desc(copilotReviewSessions.updatedAt))
    }

    const sessionIds = sessions.map((s) => s.id)
    const messagesBySession = new Map<string, ReviewMessageApi[]>()

    if (sessionIds.length > 0) {
      const allMessages = await db
        .select()
        .from(copilotReviewItems)
        .where(
          and(
            inArray(copilotReviewItems.sessionId, sessionIds),
            eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
          )
        )
        .orderBy(asc(copilotReviewItems.sessionId), asc(copilotReviewItems.sequence))

      for (const msg of allMessages) {
        const list = messagesBySession.get(msg.sessionId) ?? []
        list.push(mapReviewItemToApi(msg))
        messagesBySession.set(msg.sessionId, list)
      }
    }

    const transformedChats = sessions.map((session) =>
      mapSessionToApiResponse(session, {
        messageCount: messagesBySession.get(session.id)?.length ?? 0,
        messages: messagesBySession.get(session.id) ?? [],
      })
    )

    logger.info(
      `Retrieved ${transformedChats.length} review sessions for ${workflowId ? `workflow ${workflowId}` : `session ${reviewSessionId}`}`
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
