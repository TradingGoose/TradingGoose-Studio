import { hydrateDashboardListingData } from '@/lib/listing/hydrate-ui'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentContent,
  normalizeDashboardLayoutDocumentContent,
  resolveDashboardLayout,
  serializeDashboardLayoutDocument,
} from '@/widgets/layout-document'
import { resolveEffectiveDashboardLayout } from '@/widgets/widget-contracts'

export type DashboardLayoutReadProjection = {
  documentFormat: typeof DASHBOARD_LAYOUT_DOCUMENT_FORMAT
  entityDocument: string
  effectiveLayout: unknown
}

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

export function serializeDashboardLayoutForCopilot(
  content: DashboardLayoutDocumentContent
): string {
  return serializeDashboardLayoutDocument(
    projectDashboardLayoutValueForCopilot(content) as DashboardLayoutDocumentContent
  )
}

export async function buildDashboardLayoutReadProjection(
  content: DashboardLayoutDocumentContent
): Promise<DashboardLayoutReadProjection> {
  const canonicalContent = normalizeDashboardLayoutDocumentContent(content)
  const resolvedLayout = resolveDashboardLayout(canonicalContent.layout, canonicalContent.widgets)
  const effectiveLayoutSource = resolveEffectiveDashboardLayout(
    resolvedLayout,
    canonicalContent.colorPairs
  )
  const { layout: effectiveLayout } = await hydrateDashboardListingData(effectiveLayoutSource, {
    pairs: [],
  })

  return {
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    entityDocument: serializeDashboardLayoutForCopilot(canonicalContent),
    effectiveLayout: projectDashboardLayoutValueForCopilot(effectiveLayout),
  }
}
