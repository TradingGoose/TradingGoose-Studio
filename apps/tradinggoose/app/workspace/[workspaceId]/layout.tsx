import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const requestHeaders = await headers()
  const session = await getSession(requestHeaders, { disableCookieCache: true })

  if (!session?.user?.id) {
    const callbackTarget = requestHeaders.get('x-auth-callback-url') || `/workspace/${workspaceId}`
    redirect(`/login?reauth=1&callbackUrl=${encodeURIComponent(callbackTarget)}`)
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
