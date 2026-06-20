import { getSessionCookie } from 'better-auth/cookies'
import { headers } from 'next/headers'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { getSession } from '@/lib/auth'
import { approveMcpDeviceLogin } from '@/lib/mcp/auth'
import { redirect } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  code?: string | string[]
}>

function getCode(searchParams: Awaited<SearchParams>) {
  const code = searchParams.code
  return Array.isArray(code) ? code[0] : code
}

function StatusPage({ title, description }: { title: string; description: string }) {
  return (
    <div className='space-y-8 text-center'>
      <AuthPageHeader eyebrow='MCP authorization' title={title} description={description} />
    </div>
  )
}

export default async function McpAuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: SearchParams
}) {
  const [{ locale: routeLocale }, query, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ])
  const locale = routeLocale as LocaleCode
  const code = getCode(query)

  if (!code) {
    return (
      <StatusPage
        title='Invalid Copilot MCP login'
        description='The local setup command did not provide a valid login code.'
      />
    )
  }

  const session = await getSession(requestHeaders)
  if (!session?.user?.id) {
    return redirect({
      href: {
        pathname: '/login',
        query: {
          ...(getSessionCookie(requestHeaders) ? { reauth: '1' } : {}),
          callbackUrl: `/mcp/authorize?code=${encodeURIComponent(code)}`,
        },
      },
      locale,
    })
  }

  const result = await approveMcpDeviceLogin({
    code,
    userId: session.user.id,
  })

  if (result.status === 'expired') {
    return (
      <StatusPage
        title='MCP login expired'
        description='Return to your terminal and run the TradingGoose Copilot MCP login command again.'
      />
    )
  }

  return (
    <StatusPage
      title='MCP login approved'
      description='Return to your terminal to finish configuring your local agent.'
    />
  )
}
