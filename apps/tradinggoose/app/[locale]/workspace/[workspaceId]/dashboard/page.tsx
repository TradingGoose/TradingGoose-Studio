import { getSession } from '@/lib/auth'
import {
  activateDashboardLayout,
  ensureDashboardLayoutProvisioned,
  readActiveDashboardLayoutProjection,
} from '@/lib/dashboard-layouts/operations'
import { getCachedWorkspaceAccess } from '@/lib/permissions/utils'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import { redirect } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'

export default async function WorkspaceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceId: string }>
  searchParams?: Promise<{ layoutId?: string }>
}) {
  const { locale: routeLocale, workspaceId } = await params
  const locale = routeLocale as LocaleCode
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
  const requestedLayoutId = (await searchParams)?.layoutId
  if (requestedLayoutId && projection.layouts.some((layout) => layout.id === requestedLayoutId)) {
    if (requestedLayoutId !== projection.activeLayout?.id) {
      await activateDashboardLayout(scope, requestedLayoutId)
    }
    redirect({ href: `/workspace/${workspaceId}/dashboard`, locale })
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
