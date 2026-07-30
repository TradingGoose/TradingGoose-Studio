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
  mockAuthorizeSubscriptionReference,
  mockToBillingReference,
  mockGetActiveSubscriptionForReference,
  mockGetBillingTierById,
  mockUserCanAccessPrivateBillingTier,
  mockEvaluateSubscriptionTierAvailability,
} = vi.hoisted(() => ({
  mockAuthHandler: vi.fn(),
  mockLoadSystemOAuthClientCredentials: vi.fn(),
  mockRunWithSystemOAuthClientCredentials: vi.fn(),
  mockIsSignInOAuthProviderId: vi.fn(
    (providerId: string) => providerId === 'github' || providerId === 'google'
  ),
  mockGetSession: vi.fn(),
  mockAuthorizeSubscriptionReference: vi.fn(),
  mockToBillingReference: vi.fn(),
  mockGetActiveSubscriptionForReference: vi.fn(),
  mockGetBillingTierById: vi.fn(),
  mockUserCanAccessPrivateBillingTier: vi.fn(),
  mockEvaluateSubscriptionTierAvailability: vi.fn(),
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
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/billing/authorization', () => ({
  authorizeSubscriptionReference: (...args: unknown[]) =>
    mockAuthorizeSubscriptionReference(...args),
  toBillingReference: (...args: unknown[]) => mockToBillingReference(...args),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getActiveSubscriptionForReference: (...args: unknown[]) =>
    mockGetActiveSubscriptionForReference(...args),
}))
vi.mock('@/lib/billing/tiers', () => ({
  getBillingTierById: (...args: unknown[]) => mockGetBillingTierById(...args),
  userCanAccessPrivateBillingTier: (...args: unknown[]) =>
    mockUserCanAccessPrivateBillingTier(...args),
}))
vi.mock('@/lib/billing/tier-availability-policy', () => ({
  evaluateSubscriptionTierAvailability: (...args: unknown[]) =>
    mockEvaluateSubscriptionTierAvailability(...args),
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
    mockRunWithSystemOAuthClientCredentials.mockImplementation(async (callback: () => Response) =>
      callback()
    )
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeSubscriptionReference.mockResolvedValue(true)
    mockToBillingReference.mockReturnValue({ referenceType: 'user', referenceId: 'user-1' })
    mockGetActiveSubscriptionForReference.mockResolvedValue(null)
    mockGetBillingTierById.mockResolvedValue({ id: 'pro', isPublic: true, status: 'active' })
    mockEvaluateSubscriptionTierAvailability.mockReturnValue({ isSelectable: true })
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

  it.each([null, 1, true, [], {}, ' ', ' padded'])(
    'rejects malformed referenceId before authorization: %j',
    async (referenceId) => {
      const { handleAuthRequest } = await import('./route')
      const response = await handleAuthRequest(
        new Request('http://localhost/api/auth/subscription/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: 'pro', referenceId }),
        })
      )
      expect(response.status).toBe(403)
      expect(mockAuthorizeSubscriptionReference).not.toHaveBeenCalled()
      expect(mockGetBillingTierById).not.toHaveBeenCalled()
      expect(mockAuthHandler).not.toHaveBeenCalled()
    }
  )

  it('authorizes before target lookup and delegates selectable targets unchanged', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro', referenceId: '' }),
      })
    )
    expect(response.status).toBe(204)
    expect(mockAuthorizeSubscriptionReference).toHaveBeenCalledWith('user-1', 'user-1')
    expect(mockGetBillingTierById).toHaveBeenCalledWith('pro')
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('bypasses private selectability only for the authorized current Stripe subscription', async () => {
    mockGetActiveSubscriptionForReference.mockResolvedValue({
      stripeSubscriptionId: 'sub_stripe',
      billingTierId: 'private',
      plan: 'private',
    })
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/subscription/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: 'private',
          referenceId: 'user-1',
          subscriptionId: 'sub_stripe',
          customerType: 'organization',
        }),
      })
    )
    expect(response.status).toBe(204)
    expect(mockGetBillingTierById).not.toHaveBeenCalled()
    expect(mockUserCanAccessPrivateBillingTier).not.toHaveBeenCalled()
  })
})
