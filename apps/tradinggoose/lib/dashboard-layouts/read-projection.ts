import {
  collectDashboardTopologyReferences,
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutProjectionContent,
  serializeDashboardLayoutProjection,
} from '@/widgets/layout-document'
import { projectWidgetParamsForCopilot } from '@/widgets/widget-contracts'
import { createWidgetConfigValidationError } from '@/widgets/widget-mutations'

export const DASHBOARD_CREDENTIAL_PLACEHOLDER = '[redacted]'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEnvironmentReference = (value: string) => /^\s*\{\{[^{}]+\}\}\s*$/.test(value)

function alignArrayItem(items: unknown[], item: unknown, index: number): unknown {
  if (isRecord(item) && typeof item.id === 'string') {
    return items.find((candidate) => isRecord(candidate) && candidate.id === item.id)
  }
  return items[index]
}

const OMIT_CREDENTIAL = Symbol('omit-credential')

function mapCredentialSlots(
  subject: unknown,
  other: unknown,
  path: string,
  mapCredential: (value: unknown, otherValue: unknown, path: string) => unknown
): unknown {
  if (Array.isArray(subject)) {
    const otherItems = Array.isArray(other) ? other : []
    return subject.map((item, index) =>
      mapCredentialSlots(
        item,
        alignArrayItem(otherItems, item, index),
        `${path}.${index}`,
        mapCredential
      )
    )
  }
  if (!isRecord(subject)) return subject

  const otherRecord = isRecord(other) ? other : {}
  return Object.fromEntries(
    Object.entries(subject).flatMap(([key, value]) => {
      const itemPath = path ? `${path}.${key}` : key
      const mapped =
        key === 'apiKey' || key === 'apiSecret'
          ? mapCredential(value, otherRecord[key], itemPath)
          : mapCredentialSlots(value, otherRecord[key], itemPath, mapCredential)
      return mapped === OMIT_CREDENTIAL ? [] : [[key, mapped]]
    })
  )
}

export function projectDashboardLayoutValueForCopilot(value: unknown): unknown {
  return mapCredentialSlots(value, undefined, '', (item) =>
    typeof item === 'string' && item.length > 0 && !isEnvironmentReference(item)
      ? DASHBOARD_CREDENTIAL_PLACEHOLDER
      : item
  )
}

const isConcreteCredentialWrite = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value !== DASHBOARD_CREDENTIAL_PLACEHOLDER &&
  !isEnvironmentReference(value)

export function buildDashboardWidgetReviewDiffForCopilot({
  before,
  after,
  requestedParams,
}: {
  before: Record<string, unknown>
  after: Record<string, unknown>
  requestedParams: unknown
}) {
  const credentialWritePaths: string[] = []
  mapCredentialSlots(requestedParams, undefined, 'widgetDocument.params', (value, _, path) => {
    if (isConcreteCredentialWrite(value)) credentialWritePaths.push(path)
    return value
  })
  const projectedBefore = projectDashboardLayoutValueForCopilot(before) as Record<string, unknown>
  const projectedAfter = projectDashboardLayoutValueForCopilot(after) as Record<string, unknown>
  if (credentialWritePaths.length > 0) {
    projectedBefore.credentialWritePaths = []
    projectedAfter.credentialWritePaths = credentialWritePaths.sort()
  }
  return { before: projectedBefore, after: projectedAfter }
}

export function preserveDashboardLayoutCredentialPlaceholders(
  next: unknown,
  current: unknown
): unknown {
  return mapCredentialSlots(next, current, 'params', (value, currentValue, path) => {
    if (value !== DASHBOARD_CREDENTIAL_PLACEHOLDER) return value
    if (typeof currentValue !== 'string') {
      throw createWidgetConfigValidationError(path, 'Cannot preserve a missing credential value')
    }
    return currentValue
  })
}

export function omitPreservedDashboardCredentialValues(
  reviewValue: unknown,
  requestedValue: unknown
): unknown {
  return mapCredentialSlots(reviewValue, requestedValue, '', (value, requested) =>
    requested === DASHBOARD_CREDENTIAL_PLACEHOLDER ? OMIT_CREDENTIAL : value
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
