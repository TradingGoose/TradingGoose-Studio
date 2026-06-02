import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { isLocaleCode, localizeHref, type LocaleCode } from '@/i18n/utils'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string; workspaceId: string }>
}) {
  const { locale: routeLocale, workspaceId } = await params
  const locale: LocaleCode = isLocaleCode(routeLocale) ? routeLocale : 'en'
  const requestHeaders = await headers()
  const session = await getSession(requestHeaders, { disableCookieCache: true })

  if (!session?.user?.id) {
    const callbackTarget = localizeHref(locale, `/workspace/${workspaceId}/dashboard`)
    redirect(localizeHref(locale, `/login?reauth=1&callbackUrl=${encodeURIComponent(callbackTarget)}`))
  }

  const access = await checkWorkspaceAccess(workspaceId, session.user.id)

  if (!access.exists || !access.hasAccess) {
    redirect(localizeHref(locale, '/workspace'))
  }

  return (
    <Providers workspaceId={workspaceId}>
      <div className='flex h-full w-full bg-background'>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col '>{children}</div>
      </div>
    </Providers>
  )
}
