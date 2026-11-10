import { db } from '@tradinggoose/db'
import { layoutMaps, permissions, workspace } from '@tradinggoose/db/schema'
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

const logger = createLogger('ReviewTargetPermissions')
type ReviewAccessReadStore = Pick<typeof db, 'select'>

export interface ReviewAccessResult {
  hasAccess: boolean
  userPermission: PermissionType | null
  workspaceId: string | null
  isOwner: boolean
}

interface ReviewTargetAccessInput {
  entityKind: YjsDocumentKind
  entityId: string | null
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
  accessMode: ReviewAccessMode,
  readStore: ReviewAccessReadStore
): Promise<ReviewAccessResult> {
  const [workspaceRow] = await readStore
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspaceRow) {
    logger.warn('Attempt to access non-existent workspace', { userId, workspaceId })
    return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
  }

  const permissionRows = await readStore
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

async function verifySavedEntityTargetAccess(
  userId: string,
  reviewTarget: ReviewTargetAccessInput | ReviewTargetDescriptor,
  accessMode: ReviewAccessMode,
  readStore: ReviewAccessReadStore
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

    const [layout] = await readStore
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

    return verifyWorkspaceAccess(userId, layout.workspaceId, 'read', readStore)
  }

  const workspaceId = await resolveEntityWorkspaceId(
    reviewTarget.entityKind as SavedEntityKind,
    reviewTarget.entityId,
    undefined,
    readStore
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

  return verifyWorkspaceAccess(userId, workspaceId, accessMode, readStore)
}

export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string,
  accessMode: ReviewAccessMode,
  readStore: ReviewAccessReadStore = db
): Promise<ReviewAccessResult> {
  const accessContext = await readWorkflowAccessContext(workflowId, userId, readStore)
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
  accessMode: ReviewAccessMode,
  readStore: ReviewAccessReadStore = db
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
      reviewTarget.entityKind === 'dashboard_layout' ? 'read' : accessMode,
      readStore
    )
  }

  if (reviewTarget.entityKind === 'workflow') {
    if (!reviewTarget.entityId) {
      logger.warn('Workflow review target missing workflow id', { userId, reviewTarget })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    const access = await verifyWorkflowAccess(userId, reviewTarget.entityId, accessMode, readStore)
    if (reviewTarget.workspaceId && reviewTarget.workspaceId !== access.workspaceId) {
      logger.warn('Workflow workspace mismatch', {
        userId,
        workflowId: reviewTarget.entityId,
      })
      return { hasAccess: false, userPermission: null, workspaceId: null, isOwner: false }
    }

    return access
  }

  return verifySavedEntityTargetAccess(userId, reviewTarget, accessMode, readStore)
}
