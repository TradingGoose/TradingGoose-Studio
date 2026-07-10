import { hydrateDashboardListingData } from '@/lib/listing/hydrate-ui'
import type { LayoutNode } from '@/widgets/layout'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentContent,
  normalizeDashboardLayoutDocumentContent,
  resolveDashboardLayout,
  serializeDashboardLayoutDocument,
} from '@/widgets/layout-document'
import { resolveEffectiveDashboardLayout } from '@/widgets/widget-contracts'

export type DashboardLayoutReadProjection = {
  canonicalContent: DashboardLayoutDocumentContent
  documentFormat: typeof DASHBOARD_LAYOUT_DOCUMENT_FORMAT
  entityDocument: string
  hydratedLayout: LayoutNode
  hydratedColorPairs: DashboardLayoutDocumentContent['colorPairs']
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
  const [{ layout: hydratedLayout, colorPairs: hydratedColorPairs }, { layout: effectiveLayout }] =
    await Promise.all([
      hydrateDashboardListingData(resolvedLayout, canonicalContent.colorPairs),
      hydrateDashboardListingData(effectiveLayoutSource, { pairs: [] }),
    ])

  return {
    canonicalContent,
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    entityDocument: serializeDashboardLayoutDocument(canonicalContent),
    hydratedLayout,
    hydratedColorPairs,
    effectiveLayout,
  }
}
