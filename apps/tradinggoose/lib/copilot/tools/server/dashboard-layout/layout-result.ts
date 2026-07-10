import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import type { DashboardLayoutDocumentContent } from '@/widgets/layout-document'

type DashboardLayoutResultInput = {
  entityId: string
  entityName: string
  workspaceId: string
  ownerUserId: string
  content: DashboardLayoutDocumentContent
}

export async function buildDashboardLayoutResult(input: DashboardLayoutResultInput) {
  const projection = await buildDashboardLayoutReadProjection(input.content)

  return {
    entityKind: 'dashboard_layout' as const,
    entityId: input.entityId,
    entityName: input.entityName,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    documentFormat: projection.documentFormat,
    entityDocument: projection.entityDocument,
    effectiveLayout: projection.effectiveLayout,
  }
}
