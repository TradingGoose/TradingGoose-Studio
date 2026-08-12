import { toNextJsHandler } from 'better-auth/next-js'
import { auth, getSession } from '@/lib/auth'
import { hasPrivateBillingTierAccess } from '@/lib/billing/private-tier-access'
import { getBillingTierById } from '@/lib/billing/tiers'
import { isSignInOAuthProviderId } from '@/lib/oauth'
import {
  loadSystemOAuthClientCredentials,
  runWithSystemOAuthClientCredentials,
} from '@/lib/oauth/system-managed-config'

export const dynamic = 'force-dynamic'

const SYSTEM_OAUTH_CALLBACK_PATH_PREFIXES = ['/api/auth/callback/', '/api/auth/oauth2/callback/']
const SUBSCRIPTION_UPGRADE_PATH = '/api/auth/subscription/upgrade'
const SUBSCRIPTION_BILLING_PORTAL_PATH = '/api/auth/subscription/billing-portal'

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

async function authorizeSubscriptionUpgrade(request: Request): Promise<Response | null> {
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  const billingTierId = body && typeof body.plan === 'string' ? body.plan.trim() : ''

  if (!billingTierId) {
    return Response.json({ error: 'Billing tier is required' }, { status: 400 })
  }

  const session = await getSession(request.headers)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tier = await getBillingTierById(billingTierId)
  if (!tier || tier.status !== 'active') {
    return Response.json({ error: 'Billing tier is unavailable' }, { status: 403 })
  }

  if (!tier.isPublic && !(await hasPrivateBillingTierAccess(session.user.id, tier.id))) {
    return Response.json({ error: 'Billing tier is unavailable' }, { status: 403 })
  }

  return null
}

export const handleAuthRequest = async (request: Request) => {
  const pathname = new URL(request.url).pathname
  const subscriptionPathname = pathname.replace(/\/+$/, '')

  if (request.method === 'POST' && subscriptionPathname === SUBSCRIPTION_BILLING_PORTAL_PATH) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (request.method === 'POST' && subscriptionPathname === SUBSCRIPTION_UPGRADE_PATH) {
    const deniedResponse = await authorizeSubscriptionUpgrade(request)
    if (deniedResponse) {
      return deniedResponse
    }
  }

  if (!shouldHydrateSystemOAuthCredentials(pathname)) {
    return auth.handler(request)
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

export const { GET, POST } = toNextJsHandler(handleAuthRequest)
