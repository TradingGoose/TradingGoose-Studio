import { db } from '@tradinggoose/db'
import { copilotReviewSessions, layoutMaps, permissions, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  isEntityListSessionId,
  parseDashboardColorPairSessionId,
  parseDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewAccessMode,
  ReviewTargetDescriptor,
  YjsDocumentKind,
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
  entityKind: YjsDocumentKind
  entityId: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
  workspaceId: string | null
  ownerUserId?: string | null
  yjsSessionId?: string | null
}

export const canWriteWithPermission = (permission: PermissionType | null) =>
  permission === 'admin' || permission === 'write'

const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }

function resolveHighestPermission(
  rows: Array<{ permissionType: PermissionType | null }>
): PermissionType | null {
  const permissions = rows.filter(
    (row): row is { permissionType: PermissionType } => row.permissionType !== null
  )
  if (permissions.length === 0) return null

  return permissions.reduce((highest, current) =>
    permissionOrder[current.permissionType] > permissionOrder[highest.permissionType]
      ? current
      : highest
  ).permissionType
}

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
  const [workspaceRow] = await db
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspaceRow) {
    logger.warn('Attempt to access non-existent workspace', { userId, workspaceId })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  const permissionRows = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.userId, userId)
      )
    )

  return buildAccessResult({
    isOwner: workspaceRow.ownerId === userId,
    userPermission: resolveHighestPermission(permissionRows),
    workspaceId,
    accessMode,
  })
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

  if (
    reviewTarget.entityKind === 'dashboard_layout' ||
    reviewTarget.entityKind === 'dashboard_widget' ||
    reviewTarget.entityKind === 'dashboard_color_pair'
  ) {
    const ownerUserId = reviewTarget.ownerUserId ?? null
    if (!ownerUserId || ownerUserId !== userId) {
      logger.warn('Dashboard layout review target owner mismatch', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    const layoutId =
      reviewTarget.entityKind === 'dashboard_layout'
        ? reviewTarget.entityId
        : reviewTarget.entityKind === 'dashboard_widget'
          ? parseDashboardWidgetSessionId(reviewTarget.yjsSessionId ?? '')?.layoutId
          : parseDashboardColorPairSessionId(reviewTarget.yjsSessionId ?? '')?.layoutId
    if (!layoutId) {
      logger.warn('Dashboard child review target has invalid session identity', {
        userId,
        reviewTarget,
      })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    const [layout] = await db
      .select({ workspaceId: layoutMaps.workspaceId, userId: layoutMaps.userId })
      .from(layoutMaps)
      .where(eq(layoutMaps.id, layoutId))
      .limit(1)
    if (!layout || layout.userId !== ownerUserId) {
      logger.warn('Dashboard layout review target not found', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }
    if (reviewTarget.workspaceId && reviewTarget.workspaceId !== layout.workspaceId) {
      logger.warn('Dashboard layout workspace mismatch', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return verifyWorkspaceAccess(userId, layout.workspaceId, 'read')
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
  const accessContext = await readWorkflowAccessContext(workflowId, userId)
  if (!accessContext) {
    logger.warn('Attempt to access non-existent workflow', { userId, workflowId })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  const result = buildAccessResult({
    isOwner: false,
    userPermission: accessContext.isWorkspaceOwner
      ? 'admin'
      : (accessContext.workspacePermission ?? null),
    workspaceId: accessContext.workflow.workspaceId ?? null,
    accessMode,
  })
  return { ...result, isOwner: accessContext.isOwner }
}

export async function verifyReviewTargetAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput | ReviewTargetDescriptor,
  accessMode: ReviewAccessMode
): Promise<ReviewAccessResult> {
  if (reviewTarget.yjsSessionId && isEntityListSessionId(reviewTarget.yjsSessionId)) {
    if (!reviewTarget.workspaceId) {
      logger.warn('Entity-list review target missing workspaceId', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }
    if (reviewTarget.entityKind === 'dashboard_layout') {
      if (!reviewTarget.ownerUserId || reviewTarget.ownerUserId !== userId) {
        logger.warn('Dashboard layout list target owner mismatch', { userId, reviewTarget })
        return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
      }
    }
    return verifyWorkspaceAccess(
      userId,
      reviewTarget.workspaceId,
      reviewTarget.entityKind === 'dashboard_layout' ? 'read' : accessMode
    )
  }

  if (reviewTarget.entityKind === 'workflow') {
    if (!reviewTarget.entityId) {
      logger.warn('Workflow review target missing workflow id', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    const access = await verifyWorkflowAccess(userId, reviewTarget.entityId, accessMode)
    if (reviewTarget.workspaceId && reviewTarget.workspaceId !== access.workspaceId) {
      logger.warn('Workflow workspace mismatch', {
        userId,
        workflowId: reviewTarget.entityId,
      })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return access
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
 * Saved entities use Yjs editing targets keyed by entityId.
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
