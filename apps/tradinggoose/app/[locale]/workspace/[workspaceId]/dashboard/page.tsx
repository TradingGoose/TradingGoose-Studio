import { getSession } from '@/lib/auth'
import {
  ensureDashboardLayoutProvisioned,
  readActiveDashboardLayoutProjection,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
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
  const projection = await readActiveDashboardLayoutProjection(scope)
  const activeLayout = projection.activeLayout
  if (!activeLayout) {
    throw new Error(`Dashboard layout is not provisioned for workspace ${workspaceId}`)
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-background'>
      <div className='flex min-h-0 min-w-0 flex-1 overflow-hidden'>
        <DashboardClient
          initialState={activeLayout.layout}
          workspaceId={workspaceId}
          ownerUserId={userId}
          layoutId={activeLayout.id}
          initialLayoutName={activeLayout.name}
          initialLayouts={projection.layouts}
          initialColorPairs={activeLayout.colorPairs}
          workspaceCanWrite={access.canWrite}
        />
      </div>
    </div>
  )
}
