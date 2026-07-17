'use server'

import { getSession } from '@/lib/auth'
import {
  activateDashboardLayout,
  createDashboardLayout,
  deleteDashboardLayout,
  reorderDashboardLayout,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { applyDashboardStructureMutationInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import type { DashboardLayoutStructureMutation } from '@/widgets/layout-document'

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

export async function activateDashboardLayoutAction(workspaceId: string, layoutId: string) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  return activateDashboardLayout(scope, layoutId)
}

export async function reorderDashboardLayoutAction(
  workspaceId: string,
  layoutId: string,
  sortOrder: number
) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  await reorderDashboardLayout(scope, layoutId, sortOrder)
}

export async function mutateDashboardLayoutStructureAction(
  workspaceId: string,
  layoutId: string,
  mutation: DashboardLayoutStructureMutation
) {
  const scope = await requireDashboardLayoutScope(workspaceId)
  return applyDashboardStructureMutationInSocketServer({
    entityId: layoutId,
    ...scope,
    mutation,
  })
}
