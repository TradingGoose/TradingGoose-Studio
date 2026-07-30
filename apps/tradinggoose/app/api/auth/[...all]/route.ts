import { toNextJsHandler } from 'better-auth/next-js'
import { auth, getSession } from '@/lib/auth'
import { authorizeSubscriptionReference, toBillingReference } from '@/lib/billing/authorization'
import { getActiveSubscriptionForReference } from '@/lib/billing/core/subscription'
import { evaluateSubscriptionTierAvailability } from '@/lib/billing/tier-availability-policy'
import { getBillingTierById, userCanAccessPrivateBillingTier } from '@/lib/billing/tiers'
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
  const guardResponse = await guardSubscriptionUpgradeRequest(request, pathname)
  if (guardResponse) return guardResponse

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

export async function guardSubscriptionUpgradeRequest(
  request: Request,
  pathname: string
): Promise<Response | null> {
  if (request.method !== 'POST' || pathname !== SUBSCRIPTION_UPGRADE_PATH) return null
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const plan = 'plan' in body ? body.plan : null
  if (typeof plan !== 'string' || !plan.trim()) {
    return Response.json({ error: 'Invalid plan' }, { status: 400 })
  }
  const session = await getSession(request.headers)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rawReferenceId = 'referenceId' in body ? body.referenceId : undefined
  let requestedReferenceId: string
  if (rawReferenceId === undefined || rawReferenceId === '') {
    requestedReferenceId = session.user.id
  } else if (
    typeof rawReferenceId !== 'string' ||
    !rawReferenceId.trim() ||
    rawReferenceId !== rawReferenceId.trim()
  ) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  } else {
    requestedReferenceId = rawReferenceId
  }
  const authorized = await authorizeSubscriptionReference(session.user.id, requestedReferenceId)
  if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const reference = toBillingReference(session.user.id, requestedReferenceId)
  const subscriptionId = 'subscriptionId' in body ? body.subscriptionId : undefined
  if (typeof subscriptionId === 'string' && subscriptionId) {
    const current = await getActiveSubscriptionForReference(reference)
    if (
      current?.stripeSubscriptionId === subscriptionId &&
      (current.billingTierId ?? current.plan) === plan
    ) {
      return null
    }
  }
  const tier = await getBillingTierById(plan)
  if (!tier) {
    return Response.json({ error: 'Billing tier is not available' }, { status: 403 })
  }
  const isVisible =
    tier.isPublic || (await userCanAccessPrivateBillingTier(session.user.id, tier.id))
  if (!evaluateSubscriptionTierAvailability({ tier, isVisible }).isSelectable) {
    return Response.json({ error: 'Billing tier is not available' }, { status: 403 })
  }
  return null
}

export const { GET, POST } = toNextJsHandler(handleAuthRequest)
