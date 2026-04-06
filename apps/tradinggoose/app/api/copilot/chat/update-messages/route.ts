import { db } from '@tradinggoose/db'
import {
  copilotReviewItems,
  copilotReviewSessions,
  copilotReviewTurns,
} from '@tradinggoose/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import {
  dropsAcceptedLiveMutation,
  EDIT_REPLAY_BLOCKED_MESSAGE,
} from '@/lib/copilot/chat-replay-safety'
import { loadReviewSessionForUser } from '@/lib/copilot/review-sessions/permissions'
import {
  deriveReviewTurnsAndItems,
  mapReviewItemToApi,
  REVIEW_ITEM_KINDS,
} from '@/lib/copilot/review-sessions/thread-history'
import { ENTITY_KIND_WORKFLOW } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotChatUpdateAPI')
type ReviewMessageApi = ReturnType<typeof mapReviewItemToApi>
type IncomingReviewMessage = z.infer<typeof UpdateMessagesSchema>['messages'][number]

const UpdateMessagesSchema = z.object({
  reviewSessionId: z.string(),
  preserveConcurrentHistory: z.boolean().optional(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string(),
      toolCalls: z.array(z.any()).optional(),
      contentBlocks: z.array(z.any()).optional(),
      contexts: z.array(z.any()).optional(),
      citations: z.array(z.any()).optional(),
      fileAttachments: z
        .array(
          z.object({
            id: z.string(),
            key: z.string(),
            filename: z.string(),
            media_type: z.string(),
            size: z.number(),
          })
        )
        .optional(),
    })
  ),
})

function mergeSharedSessionMessages(
  currentMessages: ReviewMessageApi[],
  incomingMessages: z.infer<typeof UpdateMessagesSchema>['messages']
): z.infer<typeof UpdateMessagesSchema>['messages'] {
  const incomingIds = new Set(incomingMessages.map((message) => message.id))
  const preservedMessages = currentMessages.filter((message) => !incomingIds.has(message.id))

  return [...incomingMessages, ...preservedMessages] as z.infer<
    typeof UpdateMessagesSchema
  >['messages']
}

function isSharedSavedEntitySession(session: Awaited<ReturnType<typeof loadReviewSessionForUser>>) {
  return (
    !!session &&
    session.entityKind !== ENTITY_KIND_WORKFLOW &&
    !!session.entityId &&
    !!session.workspaceId
  )
}

function normalizeReviewMessageForPersistence(message: ReviewMessageApi | IncomingReviewMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? '',
    timestamp: message.timestamp ?? '',
    toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : [],
    contentBlocks: Array.isArray(message.contentBlocks) ? message.contentBlocks : [],
    contexts: Array.isArray(message.contexts) ? message.contexts : [],
    citations: Array.isArray(message.citations) ? message.citations : [],
    fileAttachments: Array.isArray(message.fileAttachments) ? message.fileAttachments : [],
  }
}

function arePersistedMessagesEqual(
  currentMessages: ReviewMessageApi[],
  nextMessages: z.infer<typeof UpdateMessagesSchema>['messages']
) {
  if (currentMessages.length !== nextMessages.length) {
    return false
  }

  return currentMessages.every((message, index) => {
    return (
      JSON.stringify(normalizeReviewMessageForPersistence(message)) ===
      JSON.stringify(normalizeReviewMessageForPersistence(nextMessages[index]))
    )
  })
}

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { reviewSessionId, preserveConcurrentHistory, messages } = UpdateMessagesSchema.parse(body)

    const session = await loadReviewSessionForUser(reviewSessionId, userId, { requireWrite: true })
    if (!session) {
      return createNotFoundResponse('Review session not found or unauthorized')
    }

    let persistedMessageCount = messages.length
    let replayUnsafe = false

    // Full delete-then-reinsert strategy: review turns and items have strict
    // ordering constraints (sequence columns) and parent-child relationships
    // (turn -> items) that make partial upserts fragile.  Reordering, merging
    // concurrent edits, or deleting middle messages all invalidate the existing
    // sequence values.  A full replace inside one transaction is the simplest
    // approach that guarantees consistency.  The typical message count per
    // session is low (< 200), so the overhead is acceptable.  If performance
    // becomes a concern, consider an incremental diff that recomputes sequences.
    await db.transaction(async (tx) => {
      const currentItems = await tx
        .select()
        .from(copilotReviewItems)
        .where(
          and(
            eq(copilotReviewItems.sessionId, reviewSessionId),
            eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
          )
        )
        .orderBy(asc(copilotReviewItems.sequence))

      const currentMessages = currentItems.map(mapReviewItemToApi)
      const shouldPreserveConcurrentHistory =
        preserveConcurrentHistory ?? isSharedSavedEntitySession(session)
      const nextMessages = shouldPreserveConcurrentHistory
        ? mergeSharedSessionMessages(currentMessages, messages)
        : messages
      persistedMessageCount = nextMessages.length

      if (dropsAcceptedLiveMutation(currentMessages, nextMessages)) {
        replayUnsafe = true
        return
      }

      // Short-circuit: skip the expensive delete/reinsert if nothing changed.
      if (arePersistedMessagesEqual(currentMessages, nextMessages)) {
        return
      }

      await tx.delete(copilotReviewItems).where(eq(copilotReviewItems.sessionId, reviewSessionId))
      await tx.delete(copilotReviewTurns).where(eq(copilotReviewTurns.sessionId, reviewSessionId))

      const nextHistory = deriveReviewTurnsAndItems(reviewSessionId, nextMessages)

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
        })
        .where(eq(copilotReviewSessions.id, reviewSessionId))
    })

    if (replayUnsafe) {
      return NextResponse.json({ error: EDIT_REPLAY_BLOCKED_MESSAGE }, { status: 409 })
    }

    logger.info(`[${tracker.requestId}] Successfully updated review session messages`, {
      reviewSessionId,
      newMessageCount: persistedMessageCount,
    })

    return NextResponse.json({
      success: true,
      messageCount: persistedMessageCount,
    })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Error updating review session messages:`, error)
    return createInternalServerErrorResponse('Failed to update chat messages')
  }
}
