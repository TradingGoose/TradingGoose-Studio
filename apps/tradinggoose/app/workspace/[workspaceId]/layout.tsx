import { redirect } from 'next/navigation'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { getSession } from '@/lib/auth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const access = await checkWorkspaceAccess(workspaceId, session.user.id)

  if (!access.exists || !access.hasAccess) {
    redirect('/workspace')
  }

  return (
    <Providers workspaceId={workspaceId}>
      <div className='flex h-full w-full bg-background'>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col '>{children}</div>
      </div>
    </Providers>
  )
}
