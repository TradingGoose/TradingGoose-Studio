import { getSessionCookie } from 'better-auth/cookies'
import { headers } from 'next/headers'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { getSession } from '@/lib/auth'
import { approveMcpDeviceLogin } from '@/lib/mcp/auth'
import { redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { normalizeLocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  code?: string | string[]
}>

function getCode(searchParams: Awaited<SearchParams>) {
  const code = searchParams.code
  return Array.isArray(code) ? code[0] : code
}

function StatusPage({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className='space-y-8 text-center'>
      <AuthPageHeader eyebrow={eyebrow} title={title} description={description} />
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
  const locale = normalizeLocaleCode(routeLocale)
  const mcpCopy = getPublicCopy(locale).auth.mcp
  const code = getCode(query)

  if (!code) {
    return (
      <StatusPage
        eyebrow={mcpCopy.eyebrow}
        title={mcpCopy.invalid.title}
        description={mcpCopy.invalid.description}
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
        eyebrow={mcpCopy.eyebrow}
        title={mcpCopy.expired.title}
        description={mcpCopy.expired.description}
      />
    )
  }

  return (
    <StatusPage
      eyebrow={mcpCopy.eyebrow}
      title={mcpCopy.approved.title}
      description={mcpCopy.approved.description}
    />
  )
}
