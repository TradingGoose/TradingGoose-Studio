import { hydrateDashboardListingData } from '@/lib/listing/hydrate-ui'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  type DashboardLayoutDocumentFields,
  normalizeDashboardLayoutDocumentFields,
  resolveEffectiveDashboardLayout,
  serializeDashboardLayoutDocument,
} from '@/widgets/layout-document'

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
  const { layout: hydratedLayout, colorPairs: hydratedColorPairs } =
    await hydrateDashboardListingData(canonicalFields.layout, canonicalFields.colorPairs)

  return {
    canonicalFields,
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    entityDocument: serializeDashboardLayoutDocument(canonicalFields),
    hydratedLayout,
    hydratedColorPairs,
    effectiveLayout: resolveEffectiveDashboardLayout(hydratedLayout, hydratedColorPairs),
  }
}
