'use server'

import { getSession } from '@/lib/auth'
import {
  activateDashboardLayout,
  createDashboardLayout,
  deleteDashboardLayout,
  listDashboardLayouts,
  reorderDashboardLayouts,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { renameSavedEntityIdentity } from '@/lib/saved-entities/identity'

export type DashboardLayoutListMutation =
  | { type: 'create' }
  | { type: 'activate'; layoutId: string }
  | { type: 'rename'; layoutId: string; name: string }
  | { type: 'delete'; layoutId: string }
  | { type: 'reorder'; layoutOrder: string[] }

async function requireDashboardLayoutScope(workspaceId: string) {
  const session = await getSession()
  const userId = session?.user?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const access = await getCachedWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error('Workspace access is required to edit dashboard layouts')
  }

  return { workspaceId, ownerUserId: userId }
}

export async function mutateDashboardLayoutListAction(
  workspaceId: string,
  mutation: DashboardLayoutListMutation
) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  if (mutation.type === 'create') await createDashboardLayout(scope)
  else if (mutation.type === 'activate') await activateDashboardLayout(scope, mutation.layoutId)
  else if (mutation.type === 'delete') await deleteDashboardLayout(scope, mutation.layoutId)
  else if (mutation.type === 'reorder') await reorderDashboardLayouts(scope, mutation.layoutOrder)
  else
    await renameSavedEntityIdentity({
      entityKind: 'dashboard_layout',
      entityId: mutation.layoutId,
      workspaceId,
      ownerUserId: scope.ownerUserId,
      name: mutation.name,
    })
  return listDashboardLayouts(scope)
}
