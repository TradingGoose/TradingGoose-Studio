import { toNextJsHandler } from 'better-auth/next-js'
import { auth, getSession } from '@/lib/auth'
import { authorizeSubscriptionReference, toBillingReference } from '@/lib/billing/authorization'
import { hasPrivateTierAccessRow } from '@/lib/billing/private-tier-access'
import { getBillingTierById } from '@/lib/billing/tiers'
import { isSignInOAuthProviderId } from '@/lib/oauth'
import {
  loadSystemOAuthClientCredentials,
  runWithSystemOAuthClientCredentials,
} from '@/lib/oauth/system-managed-config'

export const dynamic = 'force-dynamic'

const SYSTEM_OAUTH_CALLBACK_PATH_PREFIXES = ['/api/auth/callback/', '/api/auth/oauth2/callback/']
const SUBSCRIPTION_UPGRADE_PATH = '/api/auth/subscription/upgrade'

const isSystemOAuthCallbackPath = (pathname: string) =>
  SYSTEM_OAUTH_CALLBACK_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))

const shouldHydrateSystemOAuthCredentials = (pathname: string) =>
  isSystemOAuthCallbackPath(pathname) ||
  pathname === '/api/auth/oauth2/link' ||
  pathname === '/api/auth/sign-in/oauth2' ||
  pathname === '/api/auth/sign-in/social'

async function getRequestedSystemOAuthProviderId(request: Request, pathname: string) {
  if (isSystemOAuthCallbackPath(pathname)) {
    return pathname.split('/').at(-1)?.trim() ?? ''
  }

  if (
    pathname === '/api/auth/oauth2/link' ||
    pathname === '/api/auth/sign-in/oauth2' ||
    pathname === '/api/auth/sign-in/social'
  ) {
    const body = await request
      .clone()
      .json()
      .catch(() => null)
    if (!body || typeof body !== 'object') {
      return ''
    }

    if ('providerId' in body) {
      return String(body.providerId)
    }

    return 'provider' in body ? String(body.provider) : ''
  }

  return ''
}

export const handleAuthRequest = async (request: Request) => {
  const pathname = new URL(request.url).pathname
  const guardedUpgrade = await guardSubscriptionUpgradeRequest(request, pathname)
  if (guardedUpgrade instanceof Response) return guardedUpgrade
  const delegatedRequest = guardedUpgrade ?? request

  if (!shouldHydrateSystemOAuthCredentials(pathname)) {
    return auth.handler(delegatedRequest)
  }

  const providerId = await getRequestedSystemOAuthProviderId(request, pathname)
  if (!providerId) {
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 400 })
  }

  if (isSignInOAuthProviderId(providerId)) {
    return auth.handler(request)
  }

  const credentials = await loadSystemOAuthClientCredentials([providerId])
  if (!credentials[providerId]) {
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 400 })
  }

  return runWithSystemOAuthClientCredentials(() => auth.handler(request), credentials)
}

export async function guardSubscriptionUpgradeRequest(
  request: Request,
  pathname: string
): Promise<Request | Response | null> {
  if (request.method !== 'POST' || pathname !== SUBSCRIPTION_UPGRADE_PATH) return null
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const plan = 'plan' in body ? body.plan : null
  if (typeof plan !== 'string' || !plan.trim() || plan !== plan.trim()) {
    return Response.json({ error: 'Invalid plan' }, { status: 400 })
  }
  const session = await getSession(request.headers)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rawReferenceId = 'referenceId' in body ? body.referenceId : undefined
  if (
    typeof rawReferenceId !== 'string' ||
    !rawReferenceId.trim() ||
    rawReferenceId !== rawReferenceId.trim()
  ) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const requestedReferenceId = rawReferenceId
  const authorized = await authorizeSubscriptionReference(session.user.id, requestedReferenceId)
  if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const reference = toBillingReference(session.user.id, requestedReferenceId)
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  const canonicalRequest = new Request(request, {
    body: JSON.stringify({
      ...body,
      referenceId: reference.referenceId,
      customerType: reference.referenceType,
    }),
    headers,
  })
  const tier = await getBillingTierById(plan)
  if (!tier) {
    return Response.json({ error: 'Billing tier is not available' }, { status: 403 })
  }
  if (
    tier.status !== 'active' ||
    (!tier.isPublic && !(await hasPrivateTierAccessRow(session.user.id, tier.id)))
  ) {
    return Response.json({ error: 'Billing tier is not available' }, { status: 403 })
  }
  return canonicalRequest
}

export const { GET, POST } = toNextJsHandler(handleAuthRequest)
