import { CopilotTool } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import {
  buildSavedEntityListInfo,
  requireEntityId,
  verifySavedEntityContext,
} from '@/lib/copilot/tools/server/entities/shared'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { applyDashboardWidgetMutationInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { readPairColorContext } from '@/widgets/color-pairs'
import type { LinkedPairColor, PersistedColorPairsState } from '@/widgets/layout'
import {
  DASHBOARD_WIDGET_DOCUMENT_FORMAT,
  type DashboardWidgetDocument,
  findDashboardTopologyPanel,
  normalizeDashboardLayoutDocumentContent,
} from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'

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
    const [rawCurrent, entity] = await Promise.all([
      readBootstrappedSavedEntityFields('dashboard_layout', entityId, workspaceId, ownerUserId),
      buildSavedEntityListInfo('dashboard_layout', workspaceId, ownerUserId).then((entries) =>
        entries.find((entry) => entry.entityId === entityId)
      ),
    ])
    if (!entity) throw new Error('Dashboard layout not found')
    const current = normalizeDashboardLayoutDocumentContent(rawCurrent)
    const panel = findDashboardTopologyPanel(current.layout, args.panelId)
    if (!panel) throw new Error(`Unknown dashboard panel ${args.panelId}`)
    if (!panel.widgetKey) {
      throw new Error(`Dashboard panel ${args.panelId} has no widget; use edit_layout`)
    }
    const currentWidget = current.widgets[panel.identityId]!
    const next = applyWidgetConfigMutation({
      widgetKey: panel.widgetKey,
      widget: currentWidget,
      colorPairs: current.colorPairs,
      panelId: args.panelId,
      patch: {
        pairColor: args.pairColor,
        params: args.params,
        colorPair: args.colorPair,
      },
    })
    const identityId = panel.identityId
    const widget = next.widgetDocument
    const colorPairs = next.colorPairDiff.flatMap((diff) =>
      diff.color === 'gray'
        ? []
        : [
            {
              color: diff.color as LinkedPairColor,
              value: Object.keys(diff.after).length > 0 ? diff.after : null,
            },
          ]
    )
    const reviewBase = buildWidgetReviewDocument({
      panelId: args.panelId,
      widgetKey: panel.widgetKey,
      widgetDocument: next.beforeWidgetDocument,
      effectiveParams: next.beforeEffectiveParams,
      colorPairs: current.colorPairs,
    })
    const afterReview = buildWidgetReviewDocument({
      panelId: args.panelId,
      widgetKey: next.widgetKey,
      widgetDocument: next.widgetDocument,
      effectiveParams: next.afterEffectiveParams,
      colorPairs: next.colorPairs,
    })
    const result = {
      success: true,
      entityKind: 'dashboard_layout' as const,
      entityId,
      entityName: entity.entityName,
      workspaceId,
      ownerUserId,
      panelId: args.panelId,
      identityId,
      widgetKey: next.widgetKey,
      colorPairDiff: next.colorPairDiff,
      documentFormat: DASHBOARD_WIDGET_DOCUMENT_FORMAT,
      entityDocument: JSON.stringify(widget, null, 2),
    }

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        ...result,
        requiresReview: true,
        reviewBaseStateHash: hashServerToolReviewBase(reviewBase),
        preview: {
          documentDiff: {
            before: JSON.stringify(reviewBase, null, 2),
            after: JSON.stringify(afterReview, null, 2),
          },
        },
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, hashServerToolReviewBase(reviewBase))
    }
    await applyDashboardWidgetMutationInSocketServer({
      entityId,
      workspaceId,
      ownerUserId,
      identityId,
      widget,
      colorPairs,
    })
    return result
  },
}

function buildWidgetReviewDocument({
  panelId,
  widgetKey,
  widgetDocument,
  effectiveParams,
  colorPairs,
}: {
  panelId: string
  widgetKey: string | null
  widgetDocument: DashboardWidgetDocument | null
  effectiveParams: Record<string, unknown> | null
  colorPairs: PersistedColorPairsState
}) {
  const pairColor = isPairColor(widgetDocument?.pairColor) ? widgetDocument.pairColor : 'gray'
  return {
    panelId,
    widgetKey,
    widgetDocument,
    effectiveParams,
    colorPair: pairColor === 'gray' ? null : readPairColorContext(colorPairs, pairColor),
  }
}
