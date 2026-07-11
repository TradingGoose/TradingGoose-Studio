import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import { buildDashboardLayoutResult } from '@/lib/copilot/tools/server/dashboard-layout/layout-result'
import { requireEntityId, verifyWorkspaceContext } from '@/lib/copilot/tools/server/entities/shared'
import { readDashboardLayoutMetadata } from '@/lib/dashboard-layouts/operations'
import { projectDashboardLayoutValueForCopilot } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardWidgetReviewBase,
  buildDashboardWidgetReviewDocument,
} from '@/lib/dashboard-layouts/review-base'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardWidgetEditInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  findDashboardTopologyPanel,
  normalizeDashboardLayoutDocumentContent,
} from '@/widgets/layout-document'
import {
  applyWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

type EditWidgetArgs = {
  entityId: string
  panelId: string
  pairColor?: string
  params?: Record<string, unknown> | null
  colorPair?: Record<string, unknown> | null
}

export const editWidgetServerTool: BaseServerTool<EditWidgetArgs, any> = {
  name: CopilotTool.edit_widget,
  async execute(args, context) {
    const entityId = requireEntityId(args, 'edit_widget')
    const { userId: ownerUserId, workspaceId } = await verifyWorkspaceContext(context, 'read')
    const metadata = await readDashboardLayoutMetadata({ workspaceId, ownerUserId }, entityId)
    const rawCurrent = await readBootstrappedSavedEntityFields(
      'dashboard_layout',
      entityId,
      workspaceId,
      ownerUserId
    )
    const current = normalizeDashboardLayoutDocumentContent(rawCurrent)
    const panel = findDashboardTopologyPanel(current.layout, args.panelId)
    if (!panel) throw new Error(`Unknown dashboard panel ${args.panelId}`)
    if (!panel.widgetKey) {
      throw new Error(`Dashboard panel ${args.panelId} has no widget; use edit_layout`)
    }
    const currentWidget = current.widgets[panel.identityId]!
    const patch = {
      ...(args.pairColor === undefined ? {} : { pairColor: args.pairColor }),
      ...(args.params === undefined ? {} : { params: args.params }),
      ...(args.colorPair === undefined ? {} : { colorPair: args.colorPair }),
    } satisfies WidgetConfigMutationPatch
    const next = applyWidgetConfigMutation({
      widgetKey: panel.widgetKey,
      widget: currentWidget,
      colorPairs: current.colorPairs,
      panelId: args.panelId,
      patch,
    })
    const identityId = panel.identityId
    const widget = next.widgetDocument
    const nextContent = normalizeDashboardLayoutDocumentContent({
      ...current,
      widgets: { ...current.widgets, [identityId]: widget },
      colorPairs: next.colorPairs,
    })
    const reviewBase = buildDashboardWidgetReviewBase(current, args.panelId, next.reviewBase, patch)
    const beforeReview = buildDashboardWidgetReviewDocument(current, args.panelId)
    const afterReview = buildDashboardWidgetReviewDocument(nextContent, args.panelId)
    const result = {
      success: true,
      ...(await buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: nextContent,
      })),
    }

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        ...result,
        requiresReview: true,
        reviewBaseStateHash: hashServerToolReviewBase(reviewBase),
        preview: {
          documentDiff: {
            before: JSON.stringify(projectDashboardLayoutValueForCopilot(beforeReview), null, 2),
            after: JSON.stringify(projectDashboardLayoutValueForCopilot(afterReview), null, 2),
          },
        },
      }
    }

    const committed = await applyDashboardWidgetEditInSocketServer({
      entityId,
      workspaceId,
      ownerUserId,
      panelId: args.panelId,
      patch,
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
