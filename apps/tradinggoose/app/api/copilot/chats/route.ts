import { db } from '@tradinggoose/db'
import { copilotReviewItems, copilotReviewSessions } from '@tradinggoose/db/schema'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { mapSessionToApiResponse } from '@/lib/copilot/review-sessions/api-mapping'
import {
  loadReviewSessionForUser,
  verifyReviewTargetAccess,
} from '@/lib/copilot/review-sessions/permissions'
import { REVIEW_ITEM_KINDS } from '@/lib/copilot/review-sessions/thread-history'
import {
  ENTITY_KIND_WORKFLOW,
  REVIEW_ENTITY_KINDS,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import {
  COPILOT_SESSION_KIND,
} from '@/lib/copilot/session-scope'
import { createLogger } from '@/lib/logs/console/logger'

const VALID_ENTITY_KINDS = new Set<string>(REVIEW_ENTITY_KINDS)

const logger = createLogger('CopilotChatsListAPI')

export async function GET(req: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const reviewSessionId = searchParams.get('reviewSessionId')
    const entityKind = searchParams.get('entityKind')
    const entityId = searchParams.get('entityId')
    const draftSessionId = searchParams.get('draftSessionId')
    const channelId = searchParams.get('channelId')
    const workspaceId = searchParams.get('workspaceId')

    if (entityKind && !VALID_ENTITY_KINDS.has(entityKind)) {
      return createBadRequestResponse(
        `Invalid entityKind "${entityKind}". Must be one of: ${REVIEW_ENTITY_KINDS.join(', ')}`
      )
    }

    const isExactSessionLookup =
      !!reviewSessionId &&
      !workflowId &&
      !entityKind &&
      !entityId &&
      !draftSessionId &&
      !channelId &&
      !workspaceId

    if (isExactSessionLookup) {
      const [session, counts] = await Promise.all([
        loadReviewSessionForUser(reviewSessionId, userId),
        db
          .select({
            sessionId: copilotReviewItems.sessionId,
            count: count(),
          })
          .from(copilotReviewItems)
          .where(
            and(
              eq(copilotReviewItems.sessionId, reviewSessionId),
              eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
            )
          )
          .groupBy(copilotReviewItems.sessionId),
      ])

      if (!session) {
        return NextResponse.json({ error: 'Review session not found or unauthorized' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        chats: [mapSessionToApiResponse(session, { messageCount: counts[0]?.count ?? 0 })],
      })
    }

    const isSavedEntityListQuery =
      !workflowId &&
      entityKind !== null &&
      entityKind !== ENTITY_KIND_WORKFLOW &&
      !!entityId &&
      !!workspaceId &&
      !draftSessionId &&
      !channelId

    if (isSavedEntityListQuery) {
      const access = await verifyReviewTargetAccess(userId, {
        entityKind: entityKind as ReviewEntityKind,
        entityId,
        draftSessionId: null,
        reviewSessionId,
        workspaceId,
      })

      if (!access.hasAccess) {
        return NextResponse.json({ success: true, chats: [] })
      }
    }

    const conditions = []

    if (channelId) {
      conditions.push(eq(copilotReviewSessions.userId, userId))
      conditions.push(eq(copilotReviewSessions.entityKind, COPILOT_SESSION_KIND))
      conditions.push(eq(copilotReviewSessions.channelId, channelId))
      if (workspaceId) {
        conditions.push(eq(copilotReviewSessions.workspaceId, workspaceId))
      } else {
        conditions.push(isNull(copilotReviewSessions.workspaceId))
      }
    } else {
      if (!isSavedEntityListQuery) {
        conditions.push(eq(copilotReviewSessions.userId, userId))
      }

      if (workflowId) {
        conditions.push(eq(copilotReviewSessions.entityKind, ENTITY_KIND_WORKFLOW))
        conditions.push(eq(copilotReviewSessions.entityId, workflowId))
      } else {
        if (entityKind) {
          conditions.push(eq(copilotReviewSessions.entityKind, entityKind))
        }
        if (entityId) {
          conditions.push(eq(copilotReviewSessions.entityId, entityId))
        }
      }

      if (draftSessionId) {
        conditions.push(eq(copilotReviewSessions.draftSessionId, draftSessionId))
      }
      if (workspaceId) {
        conditions.push(eq(copilotReviewSessions.workspaceId, workspaceId))
      }
    }

    if (conditions.length === 0) {
      return createBadRequestResponse(
        'channelId, workflowId, or entity filters are required when listing chats'
      )
    }

    const sessionCondition = and(...conditions)

    const sessionIdsSubquery = db
      .select({ id: copilotReviewSessions.id })
      .from(copilotReviewSessions)
      .where(sessionCondition)

    const [sessions, counts] = await Promise.all([
      db
        .select({
          id: copilotReviewSessions.id,
          userId: copilotReviewSessions.userId,
          workspaceId: copilotReviewSessions.workspaceId,
          channelId: copilotReviewSessions.channelId,
          entityKind: copilotReviewSessions.entityKind,
          entityId: copilotReviewSessions.entityId,
          draftSessionId: copilotReviewSessions.draftSessionId,
          title: copilotReviewSessions.title,
          conversationId: copilotReviewSessions.conversationId,
          createdAt: copilotReviewSessions.createdAt,
          updatedAt: copilotReviewSessions.updatedAt,
        })
        .from(copilotReviewSessions)
        .where(sessionCondition)
        .orderBy(desc(copilotReviewSessions.updatedAt)),
      db
        .select({
          sessionId: copilotReviewItems.sessionId,
          count: count(),
        })
        .from(copilotReviewItems)
        .where(
          and(
            inArray(copilotReviewItems.sessionId, sessionIdsSubquery),
            eq(copilotReviewItems.kind, REVIEW_ITEM_KINDS.MESSAGE)
          )
        )
        .groupBy(copilotReviewItems.sessionId),
    ])

    const messageCounts: Record<string, number> = Object.fromEntries(
      counts.map((c) => [c.sessionId, c.count])
    )

    const chats = sessions.map((session) =>
      mapSessionToApiResponse(session, { messageCount: messageCounts[session.id] ?? 0 })
    )

    logger.info(`Retrieved ${chats.length} review sessions for user ${userId}`)

    return NextResponse.json({ success: true, chats })
  } catch (error) {
    logger.error('Error fetching user copilot review sessions:', error)
    return createInternalServerErrorResponse('Failed to fetch user review sessions')
  }
}
