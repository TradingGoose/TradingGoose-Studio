import {
  collectDashboardTopologyReferences,
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutProjectionContent,
  serializeDashboardLayoutProjection,
} from '@/widgets/layout-document'
import { projectWidgetParamsForCopilot } from '@/widgets/widget-contracts'

export const DASHBOARD_CREDENTIAL_PLACEHOLDER = '[redacted]'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEnvironmentReference = (value: string) => /^\s*\{\{[^{}]+\}\}\s*$/.test(value)

export function projectDashboardLayoutValueForCopilot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectDashboardLayoutValueForCopilot)
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      (key === 'apiKey' || key === 'apiSecret') &&
      typeof item === 'string' &&
      item.length > 0 &&
      !isEnvironmentReference(item)
        ? DASHBOARD_CREDENTIAL_PLACEHOLDER
        : projectDashboardLayoutValueForCopilot(item),
    ])
  )
}

export function preserveDashboardLayoutCredentialPlaceholders(
  next: unknown,
  current: unknown
): unknown {
  if (Array.isArray(next)) {
    const currentItems = Array.isArray(current) ? current : []
    return next.map((item, index) =>
      preserveDashboardLayoutCredentialPlaceholders(item, currentItems[index])
    )
  }
  if (!isRecord(next)) return next

  const currentRecord = isRecord(current) ? current : {}
  return Object.fromEntries(
    Object.entries(next).map(([key, item]) => [
      key,
      (key === 'apiKey' || key === 'apiSecret') && item === DASHBOARD_CREDENTIAL_PLACEHOLDER
        ? currentRecord[key]
        : preserveDashboardLayoutCredentialPlaceholders(item, currentRecord[key]),
    ])
  )
}

function projectDashboardLayoutForCopilot(
  content: DashboardLayoutProjectionContent
): DashboardLayoutProjectionContent {
  const widgets = Object.fromEntries(
    [...collectDashboardTopologyReferences(content.layout)].map(([identityId, widgetKey]) => {
      const widget = content.widgets[identityId]
      if (!widget) throw new Error(`Dashboard widget ${identityId} is missing`)
      return [
        identityId,
        widgetKey
          ? { ...widget, params: projectWidgetParamsForCopilot(widgetKey, widget.params) }
          : widget,
      ]
    })
  )
  return projectDashboardLayoutValueForCopilot({
    ...content,
    widgets,
  }) as DashboardLayoutProjectionContent
}

export function serializeDashboardLayoutForCopilot(
  content: DashboardLayoutProjectionContent
): string {
  return serializeDashboardLayoutProjection(projectDashboardLayoutForCopilot(content))
}

export function buildDashboardLayoutReadProjection(content: DashboardLayoutProjectionContent) {
  return {
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    entityDocument: serializeDashboardLayoutForCopilot(content),
  }
}
