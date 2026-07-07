import { ENTITY_KIND_DASHBOARD_LAYOUT } from '@/lib/copilot/review-sessions/types'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { createDashboardLayout } from '@/lib/dashboard-layouts/operations'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityServerTool,
  readSavedEntityDocumentFields,
  requireEntityId,
  requireUserId,
  verifySavedEntityContext,
} from './shared'

/**
 * list_layouts is list-specific: it takes `workspaceId` from tool ARGS (not the
 * execution context), validates it against the context workspace when one is
 * present, and checks workspace access. Dashboard layouts stay owner-scoped, so
 * the authenticated user is always the owner of the listed rows.
 */
async function verifyDashboardLayoutWorkspaceScope(
  args: { workspaceId: string },
  context: ServerToolExecutionContext | undefined
): Promise<{ workspaceId: string; ownerUserId: string }> {
  const userId = requireUserId(context)
  const workspaceId = args.workspaceId.trim()
  if (!workspaceId) throw new Error('workspaceId is required')
  if (context?.workspaceId && context.workspaceId !== workspaceId) {
    throw new Error('workspaceId does not match execution context')
  }

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error('Access denied: You do not have permission to use this dashboard layout')
  }

  return { workspaceId, ownerUserId: userId }
}

async function hashDashboardLayoutCreateReviewBase(
  workspaceId: string,
  ownerUserId: string
): Promise<string> {
  return hashServerToolReviewBase({
    kind: ENTITY_KIND_DASHBOARD_LAYOUT,
    workspaceId,
    ownerUserId,
    entities: await buildSavedEntityListInfo(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      workspaceId,
      ownerUserId
    ),
  })
}

export const listLayoutsServerTool: EntityServerTool<{ workspaceId: string }> = {
  name: 'list_layouts',
  async execute(args, context) {
    const { workspaceId, ownerUserId } = await verifyDashboardLayoutWorkspaceScope(args, context)
    const entities = await buildSavedEntityListInfo(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      workspaceId,
      ownerUserId
    )

    return {
      entityKind: ENTITY_KIND_DASHBOARD_LAYOUT,
      entities,
      count: entities.length,
    }
  },
}

export const createLayoutServerTool: EntityServerTool<{
  name?: string
  workspaceId?: string
}> = {
  name: 'create_layout',
  async execute(args, context) {
    const scopedContext = withWorkspaceArgContext(context, args)
    const { workspaceId, ownerUserId } = await verifyDashboardLayoutWorkspaceScope(
      { workspaceId: scopedContext?.workspaceId ?? '' },
      scopedContext
    )
    const name = args.name?.trim() || 'New layout'
    const reviewBaseStateHash = await hashDashboardLayoutCreateReviewBase(workspaceId, ownerUserId)

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        requiresReview: true,
        success: true,
        entityKind: ENTITY_KIND_DASHBOARD_LAYOUT,
        entityName: name,
        workspaceId,
        ownerUserId,
        reviewBaseStateHash,
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, reviewBaseStateHash)
    }

    const created = await createDashboardLayout({ workspaceId, ownerUserId }, { name })

    return {
      success: true,
      entityKind: ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId: created.id,
      entityName: created.name,
      workspaceId,
      ownerUserId,
    }
  },
}

export const readLayoutServerTool: EntityServerTool<{ entityId: string }> = {
  name: 'read_layout',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_layout')
    const { workspaceId, ownerUserId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId,
      'read'
    )
    const fields = await readSavedEntityDocumentFields(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId,
      workspaceId,
      ownerUserId
    )
    const projection = await buildDashboardLayoutReadProjection(fields)

    return {
      ...buildDocumentEnvelope(ENTITY_KIND_DASHBOARD_LAYOUT, entityId, projection.canonicalFields),
      workspaceId,
      ownerUserId,
      effectiveLayout: projection.effectiveLayout,
    }
  },
}
