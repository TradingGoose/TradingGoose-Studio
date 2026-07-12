import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import type { DashboardLayoutProjectionContent } from '@/widgets/layout-document'

type DashboardLayoutResultInput = {
  entityId?: string
  entityName: string
  workspaceId: string
  ownerUserId: string
  content: DashboardLayoutProjectionContent
}

export function buildDashboardLayoutResult(input: DashboardLayoutResultInput) {
  const projection = buildDashboardLayoutReadProjection(input.content)

  return {
    entityKind: 'dashboard_layout' as const,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    entityName: input.entityName,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    documentFormat: projection.documentFormat,
    entityDocument: projection.entityDocument,
  }
}
