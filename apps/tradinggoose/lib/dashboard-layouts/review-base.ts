import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { DASHBOARD_CREDENTIAL_PLACEHOLDER } from '@/lib/dashboard-layouts/read-projection'
import { readPairColorContext } from '@/widgets/color-pairs'
import type {
  DashboardLayoutDocument,
  DashboardLayoutEditPlan,
  DashboardLayoutProjectionContent,
} from '@/widgets/layout-document'
import { findDashboardTopologyPanel } from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'
import { projectWidgetParamsForCopilot } from '@/widgets/widget-contracts'
import type {
  WidgetConfigMutationPatch,
  WidgetConfigMutationReviewBase,
} from '@/widgets/widget-mutations'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function omitPreservedCredentialValues(reviewValue: unknown, requestedValue: unknown): unknown {
  if (Array.isArray(reviewValue) && Array.isArray(requestedValue)) {
    return reviewValue.map((item, index) =>
      omitPreservedCredentialValues(item, requestedValue[index])
    )
  }
  if (!isRecord(reviewValue) || !isRecord(requestedValue)) return reviewValue

  return Object.fromEntries(
    Object.entries(reviewValue).flatMap(([key, value]) => {
      const requested = requestedValue[key]
      if (
        (key === 'apiKey' || key === 'apiSecret') &&
        requested === DASHBOARD_CREDENTIAL_PLACEHOLDER
      ) {
        return []
      }
      return [[key, omitPreservedCredentialValues(value, requested)]]
    })
  )
}

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
  const pairColor = isPairColor(widgetDocument.pairColor) ? widgetDocument.pairColor : 'gray'
  return {
    panelId,
    identityId: panel.identityId,
    widgetKey: panel.widgetKey,
    widgetDocument: {
      ...widgetDocument,
      params: projectWidgetParamsForCopilot(panel.widgetKey, widgetDocument.params),
    },
    colorPair: pairColor === 'gray' ? null : readPairColorContext(content.colorPairs, pairColor),
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
          params: omitPreservedCredentialValues(reviewBase.params, requestedPatch.params),
        }),
  }
}
