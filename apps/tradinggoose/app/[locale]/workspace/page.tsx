import { getSessionCookie } from 'better-auth/cookies'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'
import { getUserWorkspaces } from '@/lib/workspaces/service'
import { redirect } from '@/i18n/navigation'
import { type LocaleCode, normalizeCallbackUrl, requireCanonicalCallbackPath } from '@/i18n/utils'

type WorkspaceSearchParams = Promise<{
  callbackUrl?: string | string[]
  redirect_workflow?: string | string[]
}>

function getSearchParam(
  searchParams: Awaited<WorkspaceSearchParams>,
  key: keyof Awaited<WorkspaceSearchParams>
) {
  const value = searchParams[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizeRequestCallbackUrl(href: string | null | undefined, headers: Headers) {
  const internalCallback = normalizeCallbackUrl(href)
  if (internalCallback) {
    return internalCallback
  }

  const host = (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',', 1)[0]?.trim()
  const forwardedProtocol = headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim()
  const protocols = forwardedProtocol ? [forwardedProtocol] : ['http', 'https']

  for (const protocol of host ? protocols : []) {
    const callback = normalizeCallbackUrl(href, `${protocol}://${host}`)
    if (callback) {
      return callback
    }
  }

  return null
}

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: WorkspaceSearchParams
}) {
  const [{ locale: routeLocale }, query, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ])
  const locale = routeLocale as LocaleCode
  const session = await getSession(requestHeaders)
  const userId = session?.user?.id

  if (!userId) {
    return redirect({
      href: {
        pathname: '/login',
        query: {
          ...(getSessionCookie(requestHeaders) ? { reauth: '1' } : {}),
          callbackUrl: requireCanonicalCallbackPath(requestHeaders, 'workspace'),
        },
      },
      locale,
    })
  }

  const callbackUrl = normalizeRequestCallbackUrl(
    getSearchParam(query, 'callbackUrl'),
    requestHeaders
  )
  if (callbackUrl && callbackUrl.split(/[?#]/, 1)[0] !== '/workspace') {
    return redirect({ href: callbackUrl, locale })
  }

  const redirectWorkflowId = getSearchParam(query, 'redirect_workflow')
  if (redirectWorkflowId) {
    const access = await readWorkflowAccessContext(redirectWorkflowId, userId)
    if (
      access?.workflow.workspaceId &&
      (access.isOwner || access.isWorkspaceOwner || access.workspacePermission)
    ) {
      return redirect({ href: `/workspace/${access.workflow.workspaceId}/dashboard`, locale })
    }
  }

  const [workspace] = await getUserWorkspaces({
    userId,
    userName: session.user.name,
  })

  if (!workspace) {
    throw new Error('Expected workspace bootstrap to return a workspace')
  }

  return redirect({ href: `/workspace/${workspace.id}/dashboard`, locale })
}
