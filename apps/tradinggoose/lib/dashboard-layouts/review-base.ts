import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { omitPreservedDashboardCredentialValues } from '@/lib/dashboard-layouts/read-projection'
import type {
  DashboardLayoutDocument,
  DashboardLayoutEditPlan,
  DashboardLayoutProjectionContent,
} from '@/widgets/layout-document'
import { findDashboardTopologyPanel } from '@/widgets/layout-document'
import {
  projectWidgetParamsForCopilot,
  resolveEffectiveWidgetParams,
} from '@/widgets/widget-contracts'
import type {
  WidgetConfigMutationPatch,
  WidgetConfigMutationReviewBase,
} from '@/widgets/widget-mutations'

export const buildDashboardLayoutReviewBase = (
  content: DashboardLayoutDocument,
  _plan: DashboardLayoutEditPlan
) => ({
  layout: content.layout,
})

export function requireDashboardWidgetPanel(
  layout: DashboardLayoutProjectionContent['layout'],
  panelId: string
) {
  const panel = findDashboardTopologyPanel(layout, panelId)
  if (panel?.widgetKey) return { ...panel, widgetKey: panel.widgetKey }

  const message = panel
    ? `Dashboard panel ${panelId} has no widget; use edit_layout`
    : `Unknown dashboard panel ${panelId}`
  throw new StructuredServerToolError({
    status: 422,
    body: {
      code: 'invalid_widget_target',
      error: message,
      hint: 'Call read_layout to refresh panel ids. Use edit_layout to add or replace a widget binding before calling edit_widget.',
      retryable: true,
      issues: [{ path: 'panelId', message }],
    },
  })
}

export function buildDashboardWidgetReviewDocument(
  content: DashboardLayoutProjectionContent,
  panelId: string
) {
  const panel = requireDashboardWidgetPanel(content.layout, panelId)
  const widgetDocument = content.widgets[panel.identityId]!
  return {
    panelId,
    identityId: panel.identityId,
    widgetKey: panel.widgetKey,
    widgetDocument: {
      params: projectWidgetParamsForCopilot(
        panel.widgetKey,
        resolveEffectiveWidgetParams(
          { key: panel.widgetKey, ...widgetDocument },
          content.colorPairs
        )
      ),
    },
  }
}

export function buildDashboardWidgetReviewBase(
  content: DashboardLayoutProjectionContent,
  panelId: string,
  reviewBase: WidgetConfigMutationReviewBase,
  requestedPatch: WidgetConfigMutationPatch
) {
  const panel = requireDashboardWidgetPanel(content.layout, panelId)

  return {
    panelId,
    identityId: panel.identityId,
    widgetKey: panel.widgetKey,
    ...reviewBase,
    ...(reviewBase.params === undefined
      ? {}
      : {
          params: omitPreservedDashboardCredentialValues(reviewBase.params, requestedPatch.params),
        }),
  }
}
