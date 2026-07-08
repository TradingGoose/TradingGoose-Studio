import { hydrateDashboardListingData } from '@/lib/listing/hydrate-ui'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentFields,
  normalizeDashboardLayoutDocumentFields,
  serializeDashboardLayoutDocument,
} from '@/widgets/layout-document'
import { resolveEffectiveDashboardLayout } from '@/widgets/widget-contracts'

export type DashboardLayoutReadProjection = {
  canonicalFields: DashboardLayoutDocumentFields
  documentFormat: typeof DASHBOARD_LAYOUT_DOCUMENT_FORMAT
  entityDocument: string
  hydratedLayout: DashboardLayoutDocumentFields['layout']
  hydratedColorPairs: DashboardLayoutDocumentFields['colorPairs']
  effectiveLayout: unknown
}

export async function buildDashboardLayoutReadProjection(
  fields: Partial<DashboardLayoutDocumentFields>
): Promise<DashboardLayoutReadProjection> {
  const canonicalFields = normalizeDashboardLayoutDocumentFields(fields)
  const effectiveLayoutSource = resolveEffectiveDashboardLayout(
    canonicalFields.layout,
    canonicalFields.colorPairs
  )
  const [{ layout: hydratedLayout, colorPairs: hydratedColorPairs }, { layout: effectiveLayout }] =
    await Promise.all([
      hydrateDashboardListingData(canonicalFields.layout, canonicalFields.colorPairs),
      hydrateDashboardListingData(effectiveLayoutSource, { pairs: [] }),
    ])

  return {
    canonicalFields,
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    entityDocument: serializeDashboardLayoutDocument(canonicalFields),
    hydratedLayout,
    hydratedColorPairs,
    effectiveLayout,
  }
}
