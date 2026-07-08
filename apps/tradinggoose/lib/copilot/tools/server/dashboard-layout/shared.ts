import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { normalizeDashboardLayoutDocumentFields } from '@/widgets/layout-document'

type LayoutArgs = { entityId: string }
export type EditLayoutArgs = LayoutArgs & {
  entityDocument: string
  documentFormat?: string
  removedPanelIds?: string[]
}
export type EditWidgetArgs = LayoutArgs & {
  panelId: string
  widgetKey?: string
  pairColor?: string
  params?: Record<string, unknown> | null
  colorPair?: Record<string, unknown> | null
}

/**
 * Owner scope for one dashboard layout mutation/read. Produced from the
 * canonical `verifySavedEntityContext` result: dashboard layouts are
 * owner-scoped, so the authenticated user is always the owner.
 */
type DashboardLayoutScope = {
  workspaceId: string
  ownerUserId: string
}

export async function readLiveDashboardLayoutFields(scope: DashboardLayoutScope, layoutId: string) {
  return normalizeDashboardLayoutDocumentFields(
    await readBootstrappedSavedEntityFields(
      'dashboard_layout',
      layoutId,
      scope.workspaceId,
      scope.ownerUserId
    )
  )
}

export async function applyLiveDashboardLayoutFields(
  scope: DashboardLayoutScope,
  layoutId: string,
  fields: ReturnType<typeof normalizeDashboardLayoutDocumentFields>
) {
  return normalizeDashboardLayoutDocumentFields(
    await applySavedEntityState(
      'dashboard_layout',
      layoutId,
      fields as unknown as Record<string, unknown>,
      scope.ownerUserId
    )
  )
}
