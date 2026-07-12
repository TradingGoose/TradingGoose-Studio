import { ENTITY_KIND_DASHBOARD_LAYOUT } from '@/lib/copilot/review-sessions/types'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { buildDashboardLayoutResult } from '@/lib/copilot/tools/server/dashboard-layout/layout-result'
import {
  createDashboardLayout,
  readDashboardLayoutMetadata,
} from '@/lib/dashboard-layouts/operations'
import { readBootstrappedDashboardLayoutProjection } from '@/lib/yjs/server/bootstrap-review-target'
import { createDefaultDashboardLayoutProjection } from '@/widgets/layout-document'
import {
  buildSavedEntityListInfo,
  type EntityServerTool,
  executeRenameEntityMutation,
  type RenameEntityArgs,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

export const listLayoutsServerTool: EntityServerTool<{ workspaceId: string }> = {
  name: 'list_layout',
  async execute(args, context) {
    const { userId: ownerUserId, workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
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
    const { userId: ownerUserId, workspaceId } = await verifyWorkspaceContext(scopedContext, 'read')
    const name = args.name?.trim() || 'New layout'
    const existingLayouts = await buildSavedEntityListInfo(
      ENTITY_KIND_DASHBOARD_LAYOUT,
      workspaceId,
      ownerUserId
    )
    const reviewBaseStateHash = hashServerToolReviewBase({
      kind: ENTITY_KIND_DASHBOARD_LAYOUT,
      workspaceId,
      ownerUserId,
      entities: existingLayouts,
    })

    if (shouldStageServerToolMutationForReview(context)) {
      const content = createDefaultDashboardLayoutProjection()
      const result = buildDashboardLayoutResult({
        entityName: name,
        workspaceId,
        ownerUserId,
        content,
      })
      return {
        requiresReview: true,
        success: true,
        ...result,
        reviewBaseStateHash,
        preview: {
          documentDiff: {
            before: '',
            after: result.entityDocument,
          },
        },
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, reviewBaseStateHash)
    }

    const created = await createDashboardLayout({ workspaceId, ownerUserId }, { name })
    const content = await readBootstrappedDashboardLayoutProjection(
      created.id,
      workspaceId,
      ownerUserId
    )

    return {
      success: true,
      ...buildDashboardLayoutResult({
        entityId: created.id,
        entityName: created.name,
        workspaceId,
        ownerUserId,
        content,
      }),
    }
  },
}

export const renameLayoutServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_layout',
  execute(args, context) {
    return executeRenameEntityMutation(ENTITY_KIND_DASHBOARD_LAYOUT, 'rename_layout', args, context)
  },
}

export const readLayoutServerTool: EntityServerTool<{ entityId: string }> = {
  name: 'read_layout',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_layout')
    const { userId, workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_DASHBOARD_LAYOUT,
      entityId,
      'read'
    )
    const metadata = await readDashboardLayoutMetadata(
      { workspaceId, ownerUserId: userId },
      entityId
    )
    const content = await readBootstrappedDashboardLayoutProjection(entityId, workspaceId, userId)
    return buildDashboardLayoutResult({
      entityId,
      entityName: metadata.name,
      workspaceId,
      ownerUserId: userId,
      content,
    })
  },
}
