import { CopilotTool } from '@/lib/copilot/registry'
import {
  assertAcceptedServerToolReviewBase,
  type BaseServerTool,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import {
  applyLiveDashboardLayoutFields,
  type EditWidgetArgs,
  readLiveDashboardLayoutFields,
} from '@/lib/copilot/tools/server/dashboard-layout/shared'
import {
  requireEntityId,
  verifySavedEntityContext,
} from '@/lib/copilot/tools/server/entities/shared'
import { validateWidgetReferenceCandidates } from '@/lib/copilot/tools/server/widgets/widget-reference-validation'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import { readPairColorContext } from '@/widgets/color-pairs'
import type { PersistedColorPairsState, WidgetInstance } from '@/widgets/layout'
import { isPairColor } from '@/widgets/pair-colors'
import { applyWidgetConfigMutation, planWidgetConfigMutation } from '@/widgets/widget-mutations'

export const editWidgetServerTool: BaseServerTool<EditWidgetArgs, any> = {
  name: CopilotTool.edit_widget,
  async execute(args, context) {
    const entityId = requireEntityId(args, 'edit_widget')
    const { userId, workspaceId } = await verifySavedEntityContext(
      context,
      'dashboard_layout',
      entityId,
      'write'
    )
    const scope = { workspaceId, ownerUserId: userId }
    const current = await readLiveDashboardLayoutFields(scope, entityId)
    const patch = {
      widgetKey: args.widgetKey,
      pairColor: args.pairColor,
      params: args.params,
      colorPair: args.colorPair,
      removedWidgetPanelIds: args.removedWidgetPanelIds,
    }
    const plan = planWidgetConfigMutation({
      layout: current.layout,
      colorPairs: current.colorPairs,
      panelId: args.panelId,
      patch,
    })
    const referenceValidation = await validateWidgetReferenceCandidates(scope, plan)
    const next = applyWidgetConfigMutation({
      layout: current.layout,
      colorPairs: current.colorPairs,
      panelId: args.panelId,
      patch,
      referenceValidationScope: scope,
      referenceValidation,
    })
    const nextFields = {
      ...current,
      layout: next.layout,
      colorPairs: next.colorPairs,
    }
    if (shouldStageServerToolMutationForReview(context)) {
      const projection = await buildDashboardLayoutReadProjection(nextFields)
      return {
        requiresReview: true,
        success: true,
        entityKind: 'dashboard_layout',
        entityId,
        panelId: args.panelId,
        widget: next.widget,
        colorPairDiff: next.colorPairDiff,
        workspaceId: scope.workspaceId,
        ownerUserId: scope.ownerUserId,
        documentFormat: projection.documentFormat,
        entityDocument: projection.entityDocument,
        effectiveLayout: projection.effectiveLayout,
        reviewBaseStateHash: hashServerToolReviewBase(current),
        preview: {
          documentDiff: {
            before: JSON.stringify(
              buildWidgetReviewDocument({
                panelId: args.panelId,
                widget: next.beforeWidget,
                effectiveParams: next.beforeEffectiveParams,
                colorPairs: current.colorPairs,
              }),
              null,
              2
            ),
            after: JSON.stringify(
              buildWidgetReviewDocument({
                panelId: args.panelId,
                widget: next.widget,
                effectiveParams: next.afterEffectiveParams,
                colorPairs: next.colorPairs,
              }),
              null,
              2
            ),
          },
        },
      }
    }

    if (context?.acceptedReviewBaseStateHash) {
      assertAcceptedServerToolReviewBase(context, hashServerToolReviewBase(current))
    }

    const fields = await applyLiveDashboardLayoutFields(scope, entityId, nextFields)
    const projection = await buildDashboardLayoutReadProjection(fields)
    return {
      success: true,
      entityKind: 'dashboard_layout',
      entityId,
      panelId: args.panelId,
      widget: next.widget,
      colorPairDiff: next.colorPairDiff,
      workspaceId: scope.workspaceId,
      ownerUserId: scope.ownerUserId,
      documentFormat: projection.documentFormat,
      entityDocument: projection.entityDocument,
      effectiveLayout: projection.effectiveLayout,
    }
  },
}

function buildWidgetReviewDocument({
  panelId,
  widget,
  effectiveParams,
  colorPairs,
}: {
  panelId: string
  widget: WidgetInstance
  effectiveParams: Record<string, unknown> | null
  colorPairs: PersistedColorPairsState
}) {
  const pairColor = isPairColor(widget?.pairColor) ? widget.pairColor : 'gray'

  return {
    panelId,
    widget,
    effectiveParams,
    colorPair: pairColor === 'gray' ? null : readPairColorContext(colorPairs, pairColor),
  }
}
