import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'
import {
  loadSystemOAuthClientCredentials,
  runWithSystemOAuthClientCredentials,
} from '@/lib/oauth/system-managed-config'

export const dynamic = 'force-dynamic'

const shouldHydrateSystemOAuthCredentials = (pathname: string) =>
  pathname.includes('/oauth2/callback/') ||
  pathname.endsWith('/oauth2/link') ||
  pathname.endsWith('/sign-in/oauth2')

async function getRequestedSystemOAuthProviderId(request: Request, pathname: string) {
  if (pathname.includes('/oauth2/callback/')) {
    return pathname.split('/').at(-1)?.trim() ?? ''
  }

  if (pathname.endsWith('/oauth2/link') || pathname.endsWith('/sign-in/oauth2')) {
    const body = await request.clone().json().catch(() => null)
    return body && typeof body === 'object' && 'providerId' in body ? String(body.providerId) : ''
  }

  return ''
}

const handler = async (request: Request) => {
  const pathname = new URL(request.url).pathname

  if (!shouldHydrateSystemOAuthCredentials(pathname)) {
    return auth.handler(request)
  }

  const providerId = await getRequestedSystemOAuthProviderId(request, pathname)
  if (!providerId) {
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 400 })
  }

  const credentials = await loadSystemOAuthClientCredentials([providerId])
  if (!credentials[providerId]) {
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 400 })
  }

  return runWithSystemOAuthClientCredentials(() => auth.handler(request), credentials)
}

export const { GET, POST } = toNextJsHandler(handler)
