import { DASHBOARD_CREDENTIAL_PLACEHOLDER } from '@/lib/dashboard-layouts/read-projection'
import { readPairColorContext } from '@/widgets/color-pairs'
import type {
  DashboardLayoutDocument,
  DashboardLayoutEditPlan,
  DashboardLayoutProjectionContent,
} from '@/widgets/layout-document'
import { findDashboardTopologyPanel } from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'
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

export function buildDashboardWidgetReviewDocument(
  content: DashboardLayoutProjectionContent,
  panelId: string
) {
  const panel = findDashboardTopologyPanel(content.layout, panelId)
  if (!panel) throw new Error(`Unknown dashboard panel ${panelId}`)
  if (!panel.widgetKey) throw new Error(`Dashboard panel ${panelId} has no widget; use edit_layout`)
  const widgetDocument = content.widgets[panel.identityId]
  if (!widgetDocument) throw new Error(`Dashboard widget ${panel.identityId} is missing`)
  const pairColor = isPairColor(widgetDocument.pairColor) ? widgetDocument.pairColor : 'gray'
  return {
    panelId,
    identityId: panel.identityId,
    widgetKey: panel.widgetKey,
    widgetDocument,
    colorPair: pairColor === 'gray' ? null : readPairColorContext(content.colorPairs, pairColor),
  }
}

export function buildDashboardWidgetReviewBase(
  content: DashboardLayoutProjectionContent,
  panelId: string,
  reviewBase: WidgetConfigMutationReviewBase,
  requestedPatch: WidgetConfigMutationPatch
) {
  const panel = findDashboardTopologyPanel(content.layout, panelId)
  if (!panel) throw new Error(`Unknown dashboard panel ${panelId}`)
  if (!panel.widgetKey) throw new Error(`Dashboard panel ${panelId} has no widget; use edit_layout`)
  if (!content.widgets[panel.identityId]) {
    throw new Error(`Dashboard widget ${panel.identityId} is missing`)
  }

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
