import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  activateDashboardLayout,
  createDashboardLayout,
  DashboardLayoutListMutationSchema,
  DashboardLayoutOperationError,
  deleteDashboardLayout,
  listDashboardLayouts,
  reorderDashboardLayouts,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { renameSavedEntityIdentity, SavedEntityIdentityError } from '@/lib/saved-entities/identity'
import { createSavedEntityErrorResponse } from '@/app/api/saved-entity-error-response'
import { validateDashboardMutationRequest } from './mutation-request'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestError = validateDashboardMutationRequest(request)
  if (requestError) return requestError

  const userId = (await getSession(request.headers))?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workspaceId } = await params
  const access = await getCachedWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    return NextResponse.json({ error: 'Workspace access is required' }, { status: 403 })
  }

  const parsed = DashboardLayoutListMutationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid dashboard layout mutation' }, { status: 400 })
  }

  const scope = { workspaceId, ownerUserId: userId }
  const mutation = parsed.data
  try {
    if (mutation.type === 'create') await createDashboardLayout(scope)
    else if (mutation.type === 'activate') {
      await activateDashboardLayout(scope, mutation.layoutId)
    } else if (mutation.type === 'delete') {
      await deleteDashboardLayout(scope, mutation.layoutId)
    } else if (mutation.type === 'reorder') {
      await reorderDashboardLayouts(scope, mutation.layoutOrder)
    } else {
      await renameSavedEntityIdentity({
        entityKind: 'dashboard_layout',
        entityId: mutation.layoutId,
        workspaceId,
        ownerUserId: userId,
        name: mutation.name,
      })
    }
    return NextResponse.json(await listDashboardLayouts(scope))
  } catch (error) {
    if (
      error instanceof DashboardLayoutOperationError ||
      error instanceof SavedEntityIdentityError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const response = createSavedEntityErrorResponse(error)
    if (response) return response
    throw error
  }
}
