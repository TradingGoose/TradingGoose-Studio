import { toNextJsHandler } from 'better-auth/next-js'
import { auth, getSession } from '@/lib/auth'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { getActiveSubscriptionForReference } from '@/lib/billing/core/subscription'
import { hasPrivateBillingTierAccess } from '@/lib/billing/private-tier-access'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getStoredStripeUserCustomerId } from '@/lib/billing/stripe-customers'
import { ensurePlanChangePortalConfiguration } from '@/lib/billing/stripe-portal'
import { BILLING_ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { getBillingTierById } from '@/lib/billing/tiers'
import { getOccupiedSeatCount } from '@/lib/billing/validation/seat-management'
import { isSignInOAuthProviderId } from '@/lib/oauth'
import {
  loadSystemOAuthClientCredentials,
  runWithSystemOAuthClientCredentials,
} from '@/lib/oauth/system-managed-config'

export const dynamic = 'force-dynamic'

const SYSTEM_OAUTH_CALLBACK_PATH_PREFIXES = ['/api/auth/callback/', '/api/auth/oauth2/callback/']
const SUBSCRIPTION_UPGRADE_PATH = '/api/auth/subscription/upgrade'
const SUBSCRIPTION_CANCEL_PATH = '/api/auth/subscription/cancel'
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

async function prepareSubscriptionUpgrade(request: Request): Promise<Request | Response> {
  const parsedBody = await request
    .clone()
    .json()
    .catch(() => null)
  const body: Record<string, unknown> =
    parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody : {}
  let preparedBody = { ...body }
  preparedBody.customerType = undefined
  const billingTierId = typeof body.plan === 'string' ? body.plan.trim() : ''
  const referenceId = typeof body.referenceId === 'string' ? body.referenceId.trim() : ''
  const requestedSubscriptionId =
    typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : ''
  const requestedSeats = typeof body.seats === 'number' ? body.seats : null

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

  if (!referenceId) {
    return Response.json({ error: 'Billing subject does not match the tier' }, { status: 403 })
  }

  const canManageReference = await authorizeSubscriptionReference(session.user.id, {
    referenceType: tier.ownerType,
    referenceId,
  })
  if (!canManageReference) {
    return Response.json({ error: 'Billing subject does not match the tier' }, { status: 403 })
  }

  if (!tier.isPublic && !(await hasPrivateBillingTierAccess(session.user.id, tier.id))) {
    return Response.json({ error: 'Billing tier is unavailable' }, { status: 403 })
  }

  const existingSubscription = await getActiveSubscriptionForReference({
    referenceType: tier.ownerType,
    referenceId,
  })
  if (
    requestedSubscriptionId &&
    requestedSubscriptionId !== existingSubscription?.stripeSubscriptionId
  ) {
    return Response.json(
      { error: 'Subscription does not match the billing subject' },
      { status: 403 }
    )
  }
  const activeStripeSubscriptionId =
    existingSubscription?.stripeSubscriptionId &&
    BILLING_ACTIVE_SUBSCRIPTION_STATUSES.includes(
      existingSubscription.status as (typeof BILLING_ACTIVE_SUBSCRIPTION_STATUSES)[number]
    )
      ? existingSubscription.stripeSubscriptionId
      : null
  if (existingSubscription?.stripeSubscriptionId && !activeStripeSubscriptionId) {
    return Response.json(
      { error: 'Resolve the current subscription before changing plans' },
      { status: 409 }
    )
  }
  if (activeStripeSubscriptionId) {
    if (
      existingSubscription?.stripeCustomerId !==
      (await getStoredStripeUserCustomerId(session.user.id))
    ) {
      return Response.json(
        { error: 'Subscription billing customer does not match user' },
        { status: 403 }
      )
    }
    preparedBody = { ...preparedBody, subscriptionId: activeStripeSubscriptionId }
  }
  if (tier.ownerType === 'organization') {
    if (!Number.isSafeInteger(requestedSeats) || requestedSeats === null || requestedSeats < 1) {
      return Response.json({ error: 'Organization seat count is required' }, { status: 400 })
    }

    const occupiedSeats = await getOccupiedSeatCount(referenceId)
    const tierMinimumSeats = Math.max(tier.seatCount ?? 1, 1)
    const currentTierLicensedSeats =
      existingSubscription?.tier.id === tier.id
        ? Math.max(existingSubscription.seats ?? existingSubscription.tier.seatCount ?? 1, 1)
        : 0
    const authorizedSeats = Math.max(
      requestedSeats,
      tierMinimumSeats,
      occupiedSeats,
      currentTierLicensedSeats
    )

    const tierMaximumSeats = tier.seatMode === 'fixed' ? tierMinimumSeats : tier.seatMaximum
    if (tierMaximumSeats !== null && authorizedSeats > tierMaximumSeats) {
      return Response.json(
        { error: `Organization plan supports at most ${tierMaximumSeats} seats` },
        { status: 409 }
      )
    }

    if (authorizedSeats !== requestedSeats) {
      preparedBody = { ...preparedBody, seats: authorizedSeats }
    }
  }
  if (activeStripeSubscriptionId) {
    try {
      await ensurePlanChangePortalConfiguration(requireStripeClient())
    } catch {
      return Response.json({ error: 'Stripe Billing Portal is unavailable' }, { status: 503 })
    }
  }

  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.set('content-type', 'application/json')
  return new Request(request, {
    headers,
    body: JSON.stringify(preparedBody),
  })
}

export const handleAuthRequest = async (request: Request) => {
  const pathname = new URL(request.url).pathname
  let requestToHandle = request

  if (
    request.method === 'POST' &&
    (pathname === SUBSCRIPTION_CANCEL_PATH || pathname === SUBSCRIPTION_BILLING_PORTAL_PATH)
  ) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (request.method === 'POST' && pathname === SUBSCRIPTION_UPGRADE_PATH) {
    const preparedRequest = await prepareSubscriptionUpgrade(request)
    if (preparedRequest instanceof Response) {
      return preparedRequest
    }
    requestToHandle = preparedRequest
  }

  if (!shouldHydrateSystemOAuthCredentials(pathname)) {
    return auth.handler(requestToHandle)
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

  return runWithSystemOAuthClientCredentials(() => auth.handler(requestToHandle), credentials)
}

export const { GET, POST } = toNextJsHandler(handleAuthRequest)
