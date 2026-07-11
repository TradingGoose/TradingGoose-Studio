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
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardLayoutEditInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  applyLayoutEditDocument,
  DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentContent,
  normalizeDashboardLayoutDocumentContent,
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
    const rawCurrent = await readBootstrappedSavedEntityFields(
      'dashboard_layout',
      entityId,
      workspaceId,
      ownerUserId
    )
    const current = normalizeDashboardLayoutDocumentContent(rawCurrent)
    const plan = applyLayoutEditDocument(current, args.entityDocument, args.removedPanelIds ?? [])
    const widgets = { ...current.widgets, ...plan.createdWidgets }
    for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
    const next: DashboardLayoutDocumentContent = normalizeDashboardLayoutDocumentContent({
      ...current,
      layout: plan.layout,
      widgets,
    })
    const reviewBase = buildDashboardLayoutReviewBase(current, plan)
    const result = {
      success: true,
      ...(await buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: next,
      })),
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
      ...(await buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: committed,
      })),
    }
  },
}
