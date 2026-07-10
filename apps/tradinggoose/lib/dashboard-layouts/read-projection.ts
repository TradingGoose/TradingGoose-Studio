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
    entityDocument: serializeDashboardLayoutDocument(canonicalContent),
    effectiveLayout,
  }
}
