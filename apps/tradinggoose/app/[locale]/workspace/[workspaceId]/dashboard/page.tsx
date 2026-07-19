import { getSession } from '@/lib/auth'
import {
  activateDashboardLayout,
  ensureDashboardLayoutProvisioned,
  readActiveDashboardLayoutProjection,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'

export default async function WorkspaceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams?: Promise<{ layoutId?: string }>
}) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return <div />
  }

  const userId = session.user.id
  const access = await getCachedWorkspaceAccess(workspaceId, userId)

  if (!access.exists || !access.hasAccess) {
    return <div />
  }

  const scope = { workspaceId, ownerUserId: userId }
  await ensureDashboardLayoutProvisioned(scope)
  let projection = await readActiveDashboardLayoutProjection(scope)
  const requestedLayoutId = (await searchParams)?.layoutId
  if (
    requestedLayoutId &&
    requestedLayoutId !== projection.activeLayout?.id &&
    projection.layouts.some((layout) => layout.id === requestedLayoutId)
  ) {
    await activateDashboardLayout(scope, requestedLayoutId)
    projection = await readActiveDashboardLayoutProjection(scope)
  }
  const activeLayout = projection.activeLayout
  if (!activeLayout) {
    throw new Error(`Dashboard layout is not provisioned for workspace ${workspaceId}`)
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-background'>
      <div className='flex min-h-0 min-w-0 flex-1 overflow-hidden'>
        <DashboardClient
          initialTopology={activeLayout.topology}
          workspaceId={workspaceId}
          ownerUserId={userId}
          layoutId={activeLayout.id}
          initialLayouts={projection.layouts}
        />
      </div>
    </div>
  )
}
