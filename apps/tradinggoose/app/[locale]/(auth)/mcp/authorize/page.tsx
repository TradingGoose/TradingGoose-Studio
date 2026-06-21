import { getSessionCookie } from 'better-auth/cookies'
import { headers } from 'next/headers'
import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/auth'
import { createMcpDeviceLoginApprovalChallenge } from '@/lib/mcp/auth'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { inter } from '@/app/fonts/inter'
import { redirect } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { normalizeLocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  code?: string | string[]
  status?: string | string[]
}>

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
  const code = Array.isArray(query.code) ? query.code[0] : query.code
  const rawStatus = Array.isArray(query.status) ? query.status[0] : query.status
  const statusCopy =
    rawStatus === 'approved'
      ? mcpCopy.approved
      : rawStatus === 'cancelled'
        ? mcpCopy.cancelled
        : rawStatus === 'expired'
          ? mcpCopy.expired
          : rawStatus === 'invalid'
            ? mcpCopy.invalid
            : null
  const renderStatus = (copy: { title: string; description: string }) => (
    <div className='space-y-8 text-center'>
      <AuthPageHeader eyebrow={mcpCopy.eyebrow} title={copy.title} description={copy.description} />
    </div>
  )

  if (statusCopy) {
    return renderStatus(statusCopy)
  }

  if (!code) {
    return renderStatus(mcpCopy.invalid)
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

  const challenge = await createMcpDeviceLoginApprovalChallenge(code, session.user.id)

  if (challenge.status === 'expired') {
    return renderStatus(mcpCopy.expired)
  }

  if (challenge.status === 'approved') {
    return renderStatus(mcpCopy.approved)
  }

  return (
    <div className='space-y-8 text-center'>
      <AuthPageHeader
        eyebrow={mcpCopy.eyebrow}
        title={mcpCopy.confirm.title}
        description={mcpCopy.confirm.description}
      />
      <form method='post' action='/api/auth/mcp/authorize' className='space-y-3'>
        <input type='hidden' name='code' value={code} />
        <input type='hidden' name='approvalToken' value={challenge.approvalToken} />
        <input type='hidden' name='locale' value={locale} />
        <div className='flex flex-col gap-3 sm:flex-row sm:justify-center'>
          <Button type='submit' name='action' value='approve' className='text-[15px]'>
            {mcpCopy.confirm.approve}
          </Button>
          <Button
            type='submit'
            name='action'
            value='cancel'
            variant='outline'
            className='text-[15px]'
          >
            {mcpCopy.confirm.cancel}
          </Button>
        </div>
      </form>
      <p className={`${inter.className} text-muted-foreground text-sm`}>
        {mcpCopy.confirm.terminalHint}
      </p>
    </div>
  )
}
