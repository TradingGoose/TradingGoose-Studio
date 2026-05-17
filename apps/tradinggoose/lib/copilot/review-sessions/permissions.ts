import { db } from '@tradinggoose/db'
import { copilotReviewSessions, permissions, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  ReviewAccessMode,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import type { PermissionType } from '@/lib/permissions/utils'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { resolveEntityWorkspaceId } from '@/lib/yjs/server/entity-loaders'

const logger = createLogger('ReviewSessionPermissions')

export interface ReviewAccessResult {
  hasAccess: boolean
  userPermission: PermissionType | null
  workspaceId: string | null
  isOwner: boolean
}

interface ReviewTargetAccessInput {
  entityKind: ReviewEntityKind
  entityId: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
  workspaceId: string | null
  yjsSessionId?: string | null
}

export const canWriteWithPermission = (permission: PermissionType | null) =>
  permission === 'admin' || permission === 'write'

/**
 * Builds a ReviewAccessResult from ownership / permission information.
 * Shared by both workspace and workflow access checks.
 */
function buildAccessResult(opts: {
  isOwner: boolean
  userPermission: PermissionType | null
  workspaceId: string | null
  accessMode: ReviewAccessMode
}): ReviewAccessResult {
  if (opts.isOwner) {
    return {
      hasAccess: true,
      userPermission: 'admin',
      workspaceId: opts.workspaceId,
      isOwner: true,
    }
  }

  if (!opts.userPermission) {
    return {
      hasAccess: false,
      userPermission: null,
      workspaceId: opts.workspaceId,
      isOwner: false,
    }
  }

  if (opts.accessMode === 'write' && !canWriteWithPermission(opts.userPermission)) {
    return {
      hasAccess: false,
      userPermission: opts.userPermission,
      workspaceId: opts.workspaceId,
      isOwner: false,
    }
  }

  return {
    hasAccess: true,
    userPermission: opts.userPermission,
    workspaceId: opts.workspaceId,
    isOwner: false,
  }
}

async function verifyWorkspaceAccess(
  userId: string,
  workspaceId: string,
  accessMode: ReviewAccessMode
): Promise<ReviewAccessResult> {
  try {
    const [workspaceAccess] = await db
      .select({
        ownerId: workspace.ownerId,
        permissionType: permissions.permissionType,
      })
      .from(workspace)
      .leftJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspace.id),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceAccess) {
      logger.warn('Attempt to access non-existent workspace', { userId, workspaceId })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return buildAccessResult({
      isOwner: workspaceAccess.ownerId === userId,
      userPermission: workspaceAccess.permissionType ?? null,
      workspaceId,
      accessMode,
    })
  } catch (error) {
    logger.error('Error verifying workspace access', { error, userId, workspaceId, accessMode })
    return { hasAccess: false, userPermission: null, workspaceId, isOwner: false }
  }
}

async function verifyDraftReviewSessionAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput
): Promise<Pick<ReviewAccessResult, 'hasAccess' | 'workspaceId'>> {
  if (!reviewTarget.reviewSessionId) {
    return { hasAccess: false, workspaceId: null }
  }

  const [reviewSession] = await db
    .select({
      workspaceId: copilotReviewSessions.workspaceId,
      entityKind: copilotReviewSessions.entityKind,
      entityId: copilotReviewSessions.entityId,
      draftSessionId: copilotReviewSessions.draftSessionId,
      userId: copilotReviewSessions.userId,
    })
    .from(copilotReviewSessions)
    .where(eq(copilotReviewSessions.id, reviewTarget.reviewSessionId))
    .limit(1)

  if (!reviewSession) {
    logger.warn('Review session not found', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
    })
    return { hasAccess: false, workspaceId: null }
  }

  if (reviewSession.entityKind !== reviewTarget.entityKind) {
    logger.warn('Review session entity kind mismatch', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
      expected: reviewTarget.entityKind,
      actual: reviewSession.entityKind,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (reviewTarget.workspaceId && reviewSession.workspaceId !== reviewTarget.workspaceId) {
    logger.warn('Review session workspace mismatch', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
      expected: reviewTarget.workspaceId,
      actual: reviewSession.workspaceId,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (reviewTarget.entityId || reviewSession.entityId) {
    logger.warn('Saved entities must use entity Yjs targets, not review sessions', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
      targetEntityId: reviewTarget.entityId,
      sessionEntityId: reviewSession.entityId,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (reviewSession.userId !== userId) {
    logger.warn('Draft review session not owned by user', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (reviewTarget.draftSessionId) {
    if (reviewSession.draftSessionId !== reviewTarget.draftSessionId) {
      logger.warn('Review session draft mismatch', {
        userId,
        reviewSessionId: reviewTarget.reviewSessionId,
        expected: reviewTarget.draftSessionId,
        actual: reviewSession.draftSessionId,
      })
      return { hasAccess: false, workspaceId: reviewSession.workspaceId }
    }
  }

  return {
    hasAccess: true,
    workspaceId: reviewSession.workspaceId,
  }
}

async function verifySavedEntityTargetAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput | ReviewTargetDescriptor,
  accessMode: ReviewAccessMode
): Promise<ReviewAccessResult> {
  if (!reviewTarget.entityId) {
    logger.warn('Saved entity review target missing entity id', { userId, reviewTarget })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  const workspaceId = await resolveEntityWorkspaceId(
    reviewTarget.entityKind as SavedEntityKind,
    reviewTarget.entityId
  )
  if (!workspaceId) {
    logger.warn('Saved entity review target not found', { userId, reviewTarget })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  if (reviewTarget.workspaceId && reviewTarget.workspaceId !== workspaceId) {
    logger.warn('Saved entity workspace mismatch', {
      userId,
      entityKind: reviewTarget.entityKind,
      entityId: reviewTarget.entityId,
    })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  return verifyWorkspaceAccess(userId, workspaceId, accessMode)
}

export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string,
  accessMode: ReviewAccessMode
): Promise<ReviewAccessResult> {
  try {
    const accessContext = await readWorkflowAccessContext(workflowId, userId)
    if (!accessContext) {
      logger.warn('Attempt to access non-existent workflow', { userId, workflowId })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return buildAccessResult({
      isOwner: accessContext.isOwner,
      userPermission: accessContext.workspacePermission ?? null,
      workspaceId: accessContext.workflow.workspaceId ?? null,
      accessMode,
    })
  } catch (error) {
    logger.error('Error verifying workflow access', { error, userId, workflowId, accessMode })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }
}

export async function verifyReviewTargetAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput | ReviewTargetDescriptor,
  accessMode: ReviewAccessMode
): Promise<ReviewAccessResult> {
  if (reviewTarget.entityKind === 'workflow') {
    const workflowId =
      reviewTarget.entityId ?? ('yjsSessionId' in reviewTarget ? reviewTarget.yjsSessionId : null)

    if (!workflowId) {
      logger.warn('Workflow review target missing workflow id', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return verifyWorkflowAccess(userId, workflowId, accessMode)
  }

  if (!reviewTarget.reviewSessionId) {
    return verifySavedEntityTargetAccess(userId, reviewTarget, accessMode)
  }

  const reviewSessionAccess = await verifyDraftReviewSessionAccess(
    userId,
    reviewTarget as ReviewTargetAccessInput
  )
  if (!reviewSessionAccess.hasAccess || !reviewSessionAccess.workspaceId) {
    return {
      hasAccess: false,
      userPermission: null,
      workspaceId: reviewSessionAccess.workspaceId,
      isOwner: false,
    }
  }

  return verifyWorkspaceAccess(userId, reviewSessionAccess.workspaceId, accessMode)
}

function hasAccessToReviewSession(
  userId: string,
  session: typeof copilotReviewSessions.$inferSelect
): boolean {
  return session.userId === userId
}

/**
 * Loads a review session when the caller can access it.
 * Review-session rows are chat/draft history and remain creator-owned.
 * Saved entities use canonical Yjs entity targets keyed by entityId.
 */
export async function loadReviewSessionForUser(
  reviewSessionId: string,
  userId: string
): Promise<typeof copilotReviewSessions.$inferSelect | null> {
  const [session] = await db
    .select()
    .from(copilotReviewSessions)
    .where(eq(copilotReviewSessions.id, reviewSessionId))
    .limit(1)

  if (!session) {
    return null
  }

  const hasAccess = hasAccessToReviewSession(userId, session)
  return hasAccess ? session : null
}

export async function loadReviewSessionForUserByConversationId(
  conversationId: string,
  entityKind: string,
  userId: string
): Promise<typeof copilotReviewSessions.$inferSelect | null> {
  const sessions = await db
    .select()
    .from(copilotReviewSessions)
    .where(
      and(
        eq(copilotReviewSessions.conversationId, conversationId),
        eq(copilotReviewSessions.entityKind, entityKind)
      )
    )

  for (const session of sessions) {
    if (hasAccessToReviewSession(userId, session)) {
      return session
    }
  }

  return null
}

/**
 * Verifies that a review session exists and belongs to the given user.
 * Returns the session row (projected to `columns` if provided) or null.
 *
 * Used by the owner-only session mutation routes to enforce simple ownership.
 */
export async function verifyReviewSessionOwnership<
  T extends Partial<Record<keyof typeof copilotReviewSessions.$inferSelect, true>>,
>(
  reviewSessionId: string,
  userId: string,
  columns?: T
): Promise<
  T extends undefined
    ? typeof copilotReviewSessions.$inferSelect | null
    : Pick<
        typeof copilotReviewSessions.$inferSelect,
        Extract<keyof T, keyof typeof copilotReviewSessions.$inferSelect>
      > | null
> {
  const query = columns
    ? db
        .select(
          Object.fromEntries(
            Object.keys(columns).map((col) => [col, (copilotReviewSessions as any)[col]])
          )
        )
        .from(copilotReviewSessions)
    : db.select().from(copilotReviewSessions)

  const [session] = await query
    .where(
      and(eq(copilotReviewSessions.id, reviewSessionId), eq(copilotReviewSessions.userId, userId))
    )
    .limit(1)

  return (session ?? null) as any
}
