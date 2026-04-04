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

const UpdateMessagesSchema = z.object({
  reviewSessionId: z.string(),
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

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { reviewSessionId, messages } = UpdateMessagesSchema.parse(body)

    const session = await loadReviewSessionForUser(reviewSessionId, userId, { requireWrite: true })
    if (!session) {
      return createNotFoundResponse('Review session not found or unauthorized')
    }

    let persistedMessageCount = messages.length

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
        session.entityKind !== ENTITY_KIND_WORKFLOW && session.userId !== userId
      const nextMessages = shouldPreserveConcurrentHistory
        ? mergeSharedSessionMessages(currentMessages, messages)
        : messages
      persistedMessageCount = nextMessages.length

      // Short-circuit: skip the expensive delete/reinsert if nothing changed.
      const unchanged =
        currentMessages.length === nextMessages.length &&
        currentMessages.every(
          (cur, i) => cur.id === nextMessages[i].id && cur.content === nextMessages[i].content
        )
      if (unchanged) {
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
