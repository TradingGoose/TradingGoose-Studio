import { CopilotTool } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import {
  applyLiveDashboardLayoutFields,
  type EditLayoutArgs,
  readLiveDashboardLayoutFields,
} from '@/lib/copilot/tools/server/dashboard-layout/shared'
import {
  requireEntityId,
  verifySavedEntityContext,
} from '@/lib/copilot/tools/server/entities/shared'
import { listDashboardLayouts } from '@/lib/dashboard-layouts/operations'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import {
  applyLayoutEditDocument,
  createDashboardLayoutValidationError,
  serializeDashboardLayoutDocument,
} from '@/widgets/layout-document'

export const editLayoutServerTool: BaseServerTool<EditLayoutArgs, any> = {
  name: CopilotTool.edit_layout,
  async execute(args, context) {
    const entityId = requireEntityId(args, 'edit_layout')
    const { userId, workspaceId } = await verifySavedEntityContext(
      context,
      'dashboard_layout',
      entityId,
      'write'
    )
    const scope = { workspaceId, ownerUserId: userId }
    const current = await readLiveDashboardLayoutFields(scope, entityId)
    const next = applyLayoutEditDocument(current, args.entityDocument)
    if (next.sortOrder !== current.sortOrder) {
      const layouts = await listDashboardLayouts(scope)
      if (next.sortOrder < 0 || next.sortOrder >= layouts.length) {
        throw createDashboardLayoutValidationError(
          'entityDocument.sortOrder',
          'edit_layout sortOrder is out of range'
        )
      }
    }

    if (shouldStageServerToolMutationForReview(context)) {
      const projection = await buildDashboardLayoutReadProjection(next)
      return {
        requiresReview: true,
        success: true,
        entityKind: 'dashboard_layout',
        entityId,
        workspaceId: scope.workspaceId,
        ownerUserId: scope.ownerUserId,
        documentFormat: projection.documentFormat,
        entityDocument: projection.entityDocument,
        layout: next.layout,
        colorPairs: next.colorPairs,
        effectiveLayout: projection.effectiveLayout,
        reviewBaseStateHash: hashServerToolReviewBase(current),
        preview: {
          documentDiff: {
            before: serializeDashboardLayoutDocument(current),
            after: projection.entityDocument,
          },
        },
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, hashServerToolReviewBase(current))
    }

    const fields = await applyLiveDashboardLayoutFields(scope, entityId, next)
    const projection = await buildDashboardLayoutReadProjection(fields)
    return {
      success: true,
      entityKind: 'dashboard_layout',
      entityId,
      workspaceId: scope.workspaceId,
      ownerUserId: scope.ownerUserId,
      documentFormat: projection.documentFormat,
      entityDocument: projection.entityDocument,
      layout: fields.layout,
      colorPairs: fields.colorPairs,
      effectiveLayout: projection.effectiveLayout,
    }
  },
}
