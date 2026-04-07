import { db } from '@tradinggoose/db'
import { copilotReviewSessions, permissions, workflow, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { ReviewEntityKind, ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'
import type { PermissionType } from '@/lib/permissions/utils'

const logger = createLogger('ReviewSessionPermissions')

export interface ReviewAccessResult {
  hasAccess: boolean
  userPermission: PermissionType | null
  workspaceId: string | null
  isOwner: boolean
}

interface VerifyAccessOptions {
  requireWrite?: boolean
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
  requireWrite: boolean
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

  if (opts.requireWrite && !canWriteWithPermission(opts.userPermission)) {
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
  { requireWrite = false }: VerifyAccessOptions = {}
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
      requireWrite,
    })
  } catch (error) {
    logger.error('Error verifying workspace access', { error, userId, workspaceId, requireWrite })
    return { hasAccess: false, userPermission: null, workspaceId, isOwner: false }
  }
}

async function verifyEntityReviewSessionAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput
): Promise<Pick<ReviewAccessResult, 'hasAccess' | 'workspaceId'>> {
  if (reviewTarget.entityKind === 'workflow' || !reviewTarget.reviewSessionId) {
    return {
      hasAccess: true,
      workspaceId: reviewTarget.workspaceId,
    }
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

  if (reviewTarget.entityId && reviewSession.entityId !== reviewTarget.entityId) {
    logger.warn('Review session entity mismatch', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
      expected: reviewTarget.entityId,
      actual: reviewSession.entityId,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (!reviewSession.entityId && reviewSession.userId !== userId) {
    logger.warn('Draft review session not owned by user', {
      userId,
      reviewSessionId: reviewTarget.reviewSessionId,
    })
    return { hasAccess: false, workspaceId: reviewSession.workspaceId }
  }

  if (!reviewTarget.entityId && reviewTarget.draftSessionId) {
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

export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string,
  { requireWrite = false }: VerifyAccessOptions = {}
): Promise<ReviewAccessResult> {
  try {
    const accessContext = await getWorkflowAccessContext(workflowId, userId)
    if (!accessContext) {
      logger.warn('Attempt to access non-existent workflow', { userId, workflowId })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return buildAccessResult({
      isOwner: accessContext.isOwner,
      userPermission: accessContext.workspacePermission ?? null,
      workspaceId: accessContext.workflow.workspaceId ?? null,
      requireWrite,
    })
  } catch (error) {
    logger.error('Error verifying workflow access', { error, userId, workflowId, requireWrite })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }
}

export async function verifyReviewTargetAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput | ReviewTargetDescriptor,
  options: VerifyAccessOptions = {}
): Promise<ReviewAccessResult> {
  if (reviewTarget.entityKind === 'workflow') {
    const workflowId =
      reviewTarget.entityId ??
      ('yjsSessionId' in reviewTarget ? reviewTarget.yjsSessionId : null)

    if (!workflowId) {
      logger.warn('Workflow review target missing workflow id', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return verifyWorkflowAccess(userId, workflowId, options)
  }

  const reviewSessionAccess = await verifyEntityReviewSessionAccess(
    userId,
    reviewTarget as ReviewTargetAccessInput
  )
  if (!reviewSessionAccess.hasAccess) {
    return {
      hasAccess: false,
      userPermission: null,
      workspaceId: reviewSessionAccess.workspaceId,
      isOwner: false,
    }
  }

  const workspaceId = reviewSessionAccess.workspaceId ?? reviewTarget.workspaceId
  if (!workspaceId) {
    logger.warn('Entity review target missing workspace id', { userId, reviewTarget })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  return verifyWorkspaceAccess(userId, workspaceId, options)
}

export async function resolveWorkflowWorkspaceId(workflowId: string): Promise<string | null> {
  const [workflowRow] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  return workflowRow?.workspaceId ?? null
}

export function createPermissionError(operation: string): string {
  return `Access denied: You do not have permission to ${operation} this workflow`
}

async function hasAccessToReviewSession(
  userId: string,
  session: typeof copilotReviewSessions.$inferSelect,
  { requireWrite = false }: VerifyAccessOptions = {}
): Promise<boolean> {
  if (session.entityKind === 'workflow') {
    return session.userId === userId
  }

  if (!session.entityId || !session.workspaceId) {
    return session.userId === userId
  }

  const accessResult = await verifyWorkspaceAccess(userId, session.workspaceId, { requireWrite })
  return accessResult.hasAccess
}

/**
 * Loads a review session when the caller can access it.
 * Saved entity sessions are shared through workspace permissions; drafts and
 * workflow sessions remain creator-owned.
 */
export async function loadReviewSessionForUser(
  reviewSessionId: string,
  userId: string,
  options: VerifyAccessOptions = {}
): Promise<typeof copilotReviewSessions.$inferSelect | null> {
  const [session] = await db
    .select()
    .from(copilotReviewSessions)
    .where(eq(copilotReviewSessions.id, reviewSessionId))
    .limit(1)

  if (!session) {
    return null
  }

  const hasAccess = await hasAccessToReviewSession(userId, session, options)
  return hasAccess ? session : null
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
    : Pick<typeof copilotReviewSessions.$inferSelect, Extract<keyof T, keyof typeof copilotReviewSessions.$inferSelect>> | null
> {
  const query = columns
    ? db
        .select(
          Object.fromEntries(
            Object.keys(columns).map((col) => [
              col,
              (copilotReviewSessions as any)[col],
            ])
          )
        )
        .from(copilotReviewSessions)
    : db.select().from(copilotReviewSessions)

  const [session] = await query
    .where(
      and(
        eq(copilotReviewSessions.id, reviewSessionId),
        eq(copilotReviewSessions.userId, userId)
      )
    )
    .limit(1)

  return (session ?? null) as any
}
