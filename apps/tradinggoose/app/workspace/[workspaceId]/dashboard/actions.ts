'use server'

import { getSession } from '@/lib/auth'
import { createDashboardLayout, deleteDashboardLayout } from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'

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

export async function createDashboardLayoutAction(workspaceId: string) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  const layout = await createDashboardLayout(scope)
  return { layoutId: layout.id }
}

export async function deleteDashboardLayoutAction(workspaceId: string, layoutId: string) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  await deleteDashboardLayout(scope, layoutId)
}
