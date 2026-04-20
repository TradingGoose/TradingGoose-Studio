import { copilotReviewSessions } from '@tradinggoose/db/schema'

/**
 * Columns to SELECT when loading review sessions for API responses.
 * Shared between the single-session and list endpoints.
 */
export const SESSION_SELECT_COLUMNS = {
  id: copilotReviewSessions.id,
  userId: copilotReviewSessions.userId,
  title: copilotReviewSessions.title,
  conversationId: copilotReviewSessions.conversationId,
  workspaceId: copilotReviewSessions.workspaceId,
  entityKind: copilotReviewSessions.entityKind,
  entityId: copilotReviewSessions.entityId,
  draftSessionId: copilotReviewSessions.draftSessionId,
  createdAt: copilotReviewSessions.createdAt,
  updatedAt: copilotReviewSessions.updatedAt,
} as const

type SessionRow = Pick<
  typeof copilotReviewSessions.$inferSelect,
  | 'id'
  | 'workspaceId'
  | 'entityKind'
  | 'entityId'
  | 'draftSessionId'
  | 'title'
  | 'conversationId'
  | 'createdAt'
  | 'updatedAt'
>

/**
 * Maps a review-session DB row (or compatible object) to the standard chat API
 * response shape.  `messages` defaults to an empty array when omitted.
 */
export function mapSessionToApiResponse(
  session: SessionRow,
  opts: { messageCount: number; messages?: unknown[]; latestTurnStatus?: string | null } = {
    messageCount: 0,
  }
) {
  return {
    reviewSessionId: session.id,
    workspaceId: session.workspaceId,
    entityKind: session.entityKind,
    entityId: session.entityId,
    draftSessionId: session.draftSessionId,
    title: session.title,
    messages: opts.messages ?? [],
    messageCount: opts.messageCount,
    latestTurnStatus: opts.latestTurnStatus ?? null,
    conversationId: session.conversationId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}
