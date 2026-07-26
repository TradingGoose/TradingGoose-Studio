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
import { buildDashboardWidgetReviewDiffForCopilot } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardWidgetReviewBase,
  buildDashboardWidgetReviewDocument,
  requireDashboardWidgetPanel,
} from '@/lib/dashboard-layouts/review-base'
import { readBootstrappedDashboardLayoutProjection } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardWidgetEditInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { normalizeDashboardLayoutProjection } from '@/widgets/layout-document'
import { projectWidgetParamsForCopilot } from '@/widgets/widget-contracts'
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
    const panel = requireDashboardWidgetPanel(current.layout, args.panelId)
    const currentWidget = current.widgets[panel.identityId]!
    const patch = {
      ...(args.pairColor === undefined ? {} : { pairColor: args.pairColor }),
      ...(args.params === undefined ? {} : { params: args.params }),
      ...(args.colorPair === undefined ? {} : { colorPair: args.colorPair }),
    } satisfies WidgetConfigMutationPatch
    const next = applyWidgetConfigMutation({
      origin: 'copilot',
      widgetKey: panel.widgetKey,
      widget: currentWidget,
      colorPairs: current.colorPairs,
      panelId: args.panelId,
      patch,
    })
    const identityId = panel.identityId
    const widget = next.widgetDocument
    const nextContent = normalizeDashboardLayoutProjection({
      ...current,
      widgets: { ...current.widgets, [identityId]: widget },
      colorPairs: next.colorPairs,
    })
    const reviewBase = buildDashboardWidgetReviewBase(current, args.panelId, next.reviewBase, patch)
    const reviewDiff = buildDashboardWidgetReviewDiffForCopilot({
      before: buildDashboardWidgetReviewDocument(current, args.panelId),
      after: buildDashboardWidgetReviewDocument(nextContent, args.panelId),
      requestedParams: patch.params
        ? projectWidgetParamsForCopilot(panel.widgetKey, patch.params)
        : patch.params,
    })
    const result = {
      success: true,
      ...buildDashboardLayoutResult({
        entityId,
        entityName: metadata.name,
        workspaceId,
        ownerUserId,
        content: nextContent,
      }),
    }

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        ...result,
        requiresReview: true,
        reviewBaseStateHash: hashServerToolReviewBase(reviewBase),
        preview: {
          documentDiff: {
            before: JSON.stringify(reviewDiff.before, null, 2),
            after: JSON.stringify(reviewDiff.after, null, 2),
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
