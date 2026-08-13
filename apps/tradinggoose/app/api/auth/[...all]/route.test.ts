/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthHandler,
  mockLoadSystemOAuthClientCredentials,
  mockRunWithSystemOAuthClientCredentials,
  mockIsSignInOAuthProviderId,
  mockGetSession,
  mockGetBillingTierById,
  mockGetActiveSubscriptionForReference,
  mockHasPrivateBillingTierAccess,
  mockAuthorizeSubscriptionReference,
  mockEnsurePlanChangePortalConfiguration,
} = vi.hoisted(() => ({
  mockAuthHandler: vi.fn(),
  mockLoadSystemOAuthClientCredentials: vi.fn(),
  mockRunWithSystemOAuthClientCredentials: vi.fn(),
  mockIsSignInOAuthProviderId: vi.fn(
    (providerId: string) => providerId === 'github' || providerId === 'google'
  ),
  mockGetSession: vi.fn(),
  mockGetBillingTierById: vi.fn(),
  mockGetActiveSubscriptionForReference: vi.fn(),
  mockHasPrivateBillingTierAccess: vi.fn(),
  mockAuthorizeSubscriptionReference: vi.fn(),
  mockEnsurePlanChangePortalConfiguration: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (handler: (request: Request) => Promise<Response>) => ({
    GET: handler,
    POST: handler,
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    handler: (...args: unknown[]) => mockAuthHandler(...args),
  },
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/billing/private-tier-access', () => ({
  hasPrivateBillingTierAccess: (...args: unknown[]) => mockHasPrivateBillingTierAccess(...args),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getActiveSubscriptionForReference: (...args: unknown[]) =>
    mockGetActiveSubscriptionForReference(...args),
}))

vi.mock('@/lib/billing/authorization', () => ({
  authorizeSubscriptionReference: (...args: unknown[]) =>
    mockAuthorizeSubscriptionReference(...args),
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({ id: 'stripe-client' }),
}))

vi.mock('@/lib/billing/stripe-portal', () => ({
  ensurePlanChangePortalConfiguration: (...args: unknown[]) =>
    mockEnsurePlanChangePortalConfiguration(...args),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getBillingTierById: (...args: unknown[]) => mockGetBillingTierById(...args),
}))

vi.mock('@/lib/oauth', () => ({
  isSignInOAuthProviderId: (providerId: string) => mockIsSignInOAuthProviderId(providerId),
}))

vi.mock('@/lib/oauth/system-managed-config', () => ({
  loadSystemOAuthClientCredentials: (providerIds: string[]) =>
    mockLoadSystemOAuthClientCredentials(providerIds),
  runWithSystemOAuthClientCredentials: (
    callback: () => Promise<Response>,
    credentials: Record<string, unknown>
  ) => mockRunWithSystemOAuthClientCredentials(callback, credentials),
}))

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({})
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockHasPrivateBillingTierAccess.mockResolvedValue(false)
    mockGetActiveSubscriptionForReference.mockResolvedValue(null)
    mockAuthorizeSubscriptionReference.mockResolvedValue(true)
    mockEnsurePlanChangePortalConfiguration.mockResolvedValue('bpc_default')
    mockRunWithSystemOAuthClientCredentials.mockImplementation(async (callback: () => Response) =>
      callback()
    )
  })

  it('delegates non-system-oauth routes directly to Better Auth', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/sign-in/sso', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('delegates env-backed social auth callbacks directly to Better Auth', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/github', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockRunWithSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('starts first-subscription Checkout without requiring a Billing Portal configuration', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockEnsurePlanChangePortalConfiguration.mockRejectedValue(
      new Error('Stripe Billing Portal is not configured')
    )
    mockGetBillingTierById.mockResolvedValue({
      id: 'public-tier',
      status: 'active',
      isPublic: true,
      ownerType: 'user',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'public-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(204)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
    expect(mockHasPrivateBillingTierAccess).not.toHaveBeenCalled()
    expect(mockEnsurePlanChangePortalConfiguration).not.toHaveBeenCalled()
  })

  it('requires the plan-change Portal catalog for the subject existing subscription', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockGetActiveSubscriptionForReference.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_existing',
    })
    mockGetBillingTierById.mockResolvedValue({
      id: 'public-tier',
      status: 'active',
      isPublic: true,
      ownerType: 'user',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'public-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(204)
    expect(mockGetActiveSubscriptionForReference).toHaveBeenCalledWith({
      referenceType: 'user',
      referenceId: 'user-1',
    })
    expect(mockEnsurePlanChangePortalConfiguration).toHaveBeenCalledTimes(1)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('rejects a supplied subscription outside the subject current subscription', async () => {
    mockGetBillingTierById.mockResolvedValue({
      id: 'public-tier',
      status: 'active',
      isPublic: true,
      ownerType: 'user',
    })
    mockGetActiveSubscriptionForReference.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_current',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'public-tier',
          referenceId: 'user-1',
          customerType: 'user',
          subscriptionId: 'sub_other',
        }),
      })
    )

    expect(response.status).toBe(403)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  it('does not create a second subscription while the subject subscription is past due', async () => {
    mockGetBillingTierById.mockResolvedValue({
      id: 'public-tier',
      status: 'active',
      isPublic: true,
      ownerType: 'user',
    })
    mockGetActiveSubscriptionForReference.mockResolvedValue({
      status: 'past_due',
      stripeSubscriptionId: 'sub_past_due',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'public-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(409)
    expect(mockEnsurePlanChangePortalConfiguration).not.toHaveBeenCalled()
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  it('rejects an upgrade when the requested billing subject type does not match the tier', async () => {
    mockGetBillingTierById.mockResolvedValue({
      id: 'team-tier',
      status: 'active',
      isPublic: true,
      ownerType: 'organization',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'team-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(403)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  it('disables the unrestricted Better Auth billing portal endpoint', async () => {
    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/billing-portal', { method: 'POST' })
    )

    expect(response.status).toBe(404)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  it('rejects private tier upgrades without a persisted grant', async () => {
    mockGetBillingTierById.mockResolvedValue({
      id: 'private-tier',
      status: 'active',
      isPublic: false,
      ownerType: 'user',
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'private-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(403)
    expect(mockHasPrivateBillingTierAccess).toHaveBeenCalledWith('user-1', 'private-tier')
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  it('delegates private tier upgrades with a persisted grant', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockGetBillingTierById.mockResolvedValue({
      id: 'private-tier',
      status: 'active',
      isPublic: false,
      ownerType: 'user',
    })
    mockHasPrivateBillingTierAccess.mockResolvedValue(true)

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan: 'private-tier',
          referenceId: 'user-1',
          customerType: 'user',
        }),
      })
    )

    expect(response.status).toBe(204)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('hydrates configured system oauth credentials before delegating integration callback routes', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      'github-repo': {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/github-repo', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['github-repo'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalledTimes(1)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('hydrates Alpaca paper credentials before delegating OAuth link routes', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      'alpaca-paper': {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/link', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'alpaca-paper',
          callbackURL: 'http://localhost/workspace',
        }),
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['alpaca-paper'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalledTimes(1)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('hydrates Alpaca paper credentials before delegating OAuth callback routes', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      'alpaca-paper': {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/alpaca-paper?code=code', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['alpaca-paper'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalledTimes(1)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when a system oauth callback provider is not configured', async () => {
    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/github-repo', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'OAuth provider is not configured',
    })
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })
})
