import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { redirect } from '@/i18n/navigation'
import { CANONICAL_CALLBACK_PATH_HEADER, type LocaleCode } from '@/i18n/utils'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string; workspaceId: string }>
}) {
  const { locale: routeLocale, workspaceId } = await params
  const locale = routeLocale as LocaleCode
  const requestHeaders = await headers()
  const session = await getSession(requestHeaders)
  const userId = session?.user?.id

  if (!userId) {
    const callbackUrl = requestHeaders.get(CANONICAL_CALLBACK_PATH_HEADER)
    if (!callbackUrl) {
      throw new Error('Missing canonical callback path for workspace reauth redirect')
    }

    return redirect({
      href: {
        pathname: '/login',
        query: {
          reauth: '1',
          callbackUrl,
        },
      },
      locale,
    })
  }

  const access = await checkWorkspaceAccess(workspaceId, userId)

  if (!access.exists || !access.hasAccess) {
    redirect({ href: '/workspace', locale })
  }

  return (
    <Providers workspaceId={workspaceId}>
      <div className='flex h-full w-full bg-background'>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col '>{children}</div>
      </div>
    </Providers>
  )
}
