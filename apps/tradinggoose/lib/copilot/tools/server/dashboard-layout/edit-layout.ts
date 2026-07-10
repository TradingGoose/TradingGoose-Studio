import { CopilotTool } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import { buildDashboardLayoutResult } from '@/lib/copilot/tools/server/dashboard-layout/layout-result'
import {
  buildSavedEntityListInfo,
  requireEntityId,
  verifySavedEntityContext,
} from '@/lib/copilot/tools/server/entities/shared'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardTopologyMutationInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  applyLayoutEditDocument,
  DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentContent,
  normalizeDashboardLayoutDocumentContent,
  serializeDashboardLayoutDocument,
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
    const [rawCurrent, entity] = await Promise.all([
      readBootstrappedSavedEntityFields('dashboard_layout', entityId, workspaceId, ownerUserId),
      buildSavedEntityListInfo('dashboard_layout', workspaceId, ownerUserId).then((entries) =>
        entries.find((entry) => entry.entityId === entityId)
      ),
    ])
    if (!entity) throw new Error('Dashboard layout not found')
    const current = normalizeDashboardLayoutDocumentContent(rawCurrent)
    const plan = applyLayoutEditDocument(current, args.entityDocument, args.removedPanelIds ?? [])
    const widgets = { ...current.widgets, ...plan.createdWidgets }
    for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
    const next: DashboardLayoutDocumentContent = normalizeDashboardLayoutDocumentContent({
      ...current,
      layout: plan.layout,
      widgets,
    })
    const reviewBase = { layout: current.layout }
    const result = {
      success: true,
      ...(await buildDashboardLayoutResult({
        entityId,
        entityName: entity.entityName,
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
            before: serializeDashboardLayoutDocument(current),
            after: result.entityDocument,
          },
        },
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, hashServerToolReviewBase(reviewBase))
    }
    await applyDashboardTopologyMutationInSocketServer({
      entityId,
      workspaceId,
      ownerUserId,
      plan,
    })
    return result
  },
}
