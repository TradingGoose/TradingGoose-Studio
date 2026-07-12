import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import { buildDashboardLayoutResult } from '@/lib/copilot/tools/server/dashboard-layout/layout-result'
import {
  requireEntityId,
  verifySavedEntityContext,
} from '@/lib/copilot/tools/server/entities/shared'
import { readDashboardLayoutMetadata } from '@/lib/dashboard-layouts/operations'
import { serializeDashboardLayoutForCopilot } from '@/lib/dashboard-layouts/read-projection'
import { buildDashboardLayoutReviewBase } from '@/lib/dashboard-layouts/review-base'
import { readBootstrappedDashboardLayoutProjection } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardLayoutEditInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  applyLayoutEditDocument,
  createDefaultDashboardWidgetDocument,
  DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT,
  type DashboardLayoutProjectionContent,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'

type EditLayoutArgs = {
  entityId: string
  entityDocument: string
  documentFormat?: string
  removedPanelIds?: string[]
}

export const editLayoutServerTool: BaseServerTool<EditLayoutArgs, any> = {
  name: CopilotTool.edit_layout,
  async execute(args, context) {
    const entityId = requireEntityId(args, 'edit_layout')
    if (args.documentFormat && args.documentFormat !== DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT) {
      throw new Error(
        `Unsupported documentFormat "${args.documentFormat}". Expected ${DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT}`
      )
    }
    const { userId: ownerUserId, workspaceId } = await verifySavedEntityContext(
      context,
      'dashboard_layout',
      entityId,
      'write'
    )
    const metadata = await readDashboardLayoutMetadata({ workspaceId, ownerUserId }, entityId)
    const current = await readBootstrappedDashboardLayoutProjection(
      entityId,
      workspaceId,
      ownerUserId
    )
    const plan = applyLayoutEditDocument(
      { layout: current.layout },
      args.entityDocument,
      args.removedPanelIds ?? []
    )
    const widgets = { ...current.widgets }
    for (const binding of plan.createdBindings) {
      widgets[binding.identityId] = createDefaultDashboardWidgetDocument(binding.widgetKey)
    }
    for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
    const next: DashboardLayoutProjectionContent = normalizeDashboardLayoutProjection({
      ...current,
      layout: plan.layout,
      widgets,
    })
    const reviewBase = buildDashboardLayoutReviewBase(current, plan)
    const result = {
      success: true,
      ...buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: next,
      }),
    }

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        ...result,
        requiresReview: true,
        reviewBaseStateHash: hashServerToolReviewBase(reviewBase),
        preview: {
          documentDiff: {
            before: serializeDashboardLayoutForCopilot(current),
            after: result.entityDocument,
          },
        },
      }
    }

    const committed = await applyDashboardLayoutEditInSocketServer({
      entityId,
      workspaceId,
      ownerUserId,
      entityDocument: args.entityDocument,
      removedPanelIds: args.removedPanelIds ?? [],
      expectedReviewBaseStateHash:
        context?.acceptedReviewBaseStateHash ?? hashServerToolReviewBase(reviewBase),
    })
    return {
      success: true,
      ...buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: committed,
      }),
    }
  },
}
