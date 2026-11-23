/**
 * @vitest-environment node
 */

import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { sso } from '@better-auth/sso'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authDatabase } from '@/lib/auth/database'
import { ssoOptions } from '@/lib/sso/options'

const {
  mockGetSession,
  mockRegisterSSOProvider,
  mockIsOrganizationOwnerOrAdmin,
  mockGetOrganizationSubscription,
  mockGetBillingGateState,
  mockValidateSeatAvailability,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetBillingGateState: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn() }))
vi.mock('@/lib/organization/admission', () => ({
  withOrganizationAdmission: (_target: unknown, callback: (tx: object) => unknown) => callback({}),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      registerSSOProvider: (...args: unknown[]) => mockRegisterSSOProvider(...args),
    },
  },
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: (...args: unknown[]) => mockIsOrganizationOwnerOrAdmin(...args),
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: (...args: unknown[]) => mockGetOrganizationSubscription(...args),
}))

vi.mock('@/lib/billing/settings', () => ({
  getBillingGateState: (...args: unknown[]) => mockGetBillingGateState(...args),
}))

vi.mock('@/lib/env', () => ({
  env: {
    SSO_ENABLED: true,
  },
  getEnv: vi.fn((key: string) =>
    key === 'NEXT_PUBLIC_APP_URL' ? 'http://localhost:3000' : undefined
  ),
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

describe('SSO register route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockGetBillingGateState.mockResolvedValue({ billingEnabled: true })
    mockGetOrganizationSubscription.mockResolvedValue({
      tier: {
        ownerType: 'organization',
        canConfigureSso: true,
      },
    })
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(dns, 'lookup').mockImplementation(
      vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    )
    syncBuiltinESMExports()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    syncBuiltinESMExports()
  })

  it('requires an authenticated session', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    })
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('requires an active organization', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: null,
      },
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Active organization is required',
    })
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects members who are not org owners or admins', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Only organization owners and admins can manage SSO',
    })
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects organizations whose tier cannot configure SSO', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockGetOrganizationSubscription.mockResolvedValue({
      tier: {
        ownerType: 'organization',
        canConfigureSso: false,
      },
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Single Sign-On is not enabled for this organization',
    })
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('keeps org-admin SSO registration available when billing is disabled', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockGetBillingGateState.mockResolvedValue({ billingEnabled: false })
    mockGetOrganizationSubscription.mockResolvedValue({
      tier: null,
    })
    mockRegisterSSOProvider.mockResolvedValue({
      providerId: 'okta',
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://issuer.example.com',
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          authorization_endpoint: 'https://issuer.example.com/oauth2/v1/authorize',
          token_endpoint: 'https://issuer.example.com/oauth2/v1/token',
          userinfo_endpoint: 'https://issuer.example.com/oauth2/v1/userinfo',
          jwks_uri: 'https://issuer.example.com/oauth2/v1/keys',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    )

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalled()
  })

  it('rejects domains that normalize to an empty list before discovery', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'owner' },
      session: { activeOrganizationId: 'org' },
    })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerType: 'oidc',
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: ' ,  , ',
          clientId: 'client',
          clientSecret: 'secret',
        }),
      })
    )
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects legacy manual oidc endpoint override fields', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta',
          issuer: 'https://issuer.example.com',
          domain: 'example.com',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          authorizationEndpoint: 'https://issuer.example.com/oauth2/v1/authorize',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        'Manual OIDC endpoint overrides are not supported: authorizationEndpoint. Configure OIDC using the issuer URL only.',
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it.each(['tradier-live', 'a'.repeat(45)])('rejects %s before discovery', async (providerId) => {
    mockGetSession.mockResolvedValue({
      user: { id: 'owner' },
      session: { activeOrganizationId: 'org' },
    })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerType: 'oidc',
          providerId,
          issuer: 'https://idp.example.com',
          domain: 'example.com',
          clientId: 'client',
          clientSecret: 'secret',
        }),
      })
    )
    expect(response.status).toBe(422)
    expect(fetch).not.toHaveBeenCalled()
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('registers a 44-character OIDC provider ID for the active organization via issuer discovery', async () => {
    const providerId = 'a'.repeat(44)
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockRegisterSSOProvider.mockResolvedValue({
      providerId,
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://issuer.example.com',
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          authorization_endpoint: 'https://issuer.example.com/oauth2/v1/authorize',
          token_endpoint: 'https://issuer.example.com/oauth2/v1/token',
          userinfo_endpoint: 'https://issuer.example.com/oauth2/v1/userinfo',
          jwks_uri: 'https://issuer.example.com/oauth2/v1/keys',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    )

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId,
          issuer: 'https://issuer.example.com',
          domain: ' Example.COM, , https://Login.Example.org/path, example.com ',
          providerType: 'oidc',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('https://issuer.example.com/.well-known/openid-configuration')
    expect(options?.redirect).toBe('manual')
    expect(mockRegisterSSOProvider).toHaveBeenCalledWith({
      body: expect.objectContaining({
        providerId,
        domain: 'example.com,login.example.org',
        organizationId: 'org-1',
        oidcConfig: expect.objectContaining({
          authorizationEndpoint: 'https://issuer.example.com/oauth2/v1/authorize',
          tokenEndpoint: 'https://issuer.example.com/oauth2/v1/token',
          userInfoEndpoint: 'https://issuer.example.com/oauth2/v1/userinfo',
          jwksEndpoint: 'https://issuer.example.com/oauth2/v1/keys',
          skipDiscovery: true,
          tokenEndpointAuthentication: 'client_secret_post',
          mapping: {
            email: 'email',
            name: 'name',
            image: 'picture',
          },
        }),
      }),
      headers: expect.any(Headers),
    })
    expect(mockIsOrganizationOwnerOrAdmin).toHaveBeenCalledWith('user-1', 'org-1')
  })

  it('registers manual SAML with distinct IdP and SP identities', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockRegisterSSOProvider.mockResolvedValue({
      providerId: 'okta-saml',
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'okta-saml',
          issuer: 'https://issuer.example.com/metadata',
          domain: 'example.com',
          providerType: 'saml',
          entryPoint: 'https://idp.example.com/sso/saml',
          cert: 'certificate',
          idpEntityId: 'https://idp.example.com',
        }),
        headers: {
          'content-type': 'application/json',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledWith({
      body: expect.objectContaining({
        providerId: 'okta-saml',
        organizationId: 'org-1',
        samlConfig: expect.objectContaining({
          idpMetadata: { entityID: 'https://idp.example.com' },
          mapping: { email: 'email', name: 'name' },
        }),
      }),
      headers: expect.any(Headers),
    })
  })
  it.each([
    ['private issuer', 'https://10.0.0.2', undefined],
    ['IPv6 loopback issuer', 'https://[::1]', undefined],
    ['redirect', 'https://issuer.example.com', Response.redirect('https://other.example.com')],
    [
      'mismatched issuer',
      'https://issuer.example.com',
      Response.json({
        issuer: 'https://other.example.com',
        authorization_endpoint: 'https://issuer.example.com/auth',
        token_endpoint: 'https://issuer.example.com/token',
        jwks_uri: 'https://issuer.example.com/keys',
      }),
    ],
    [
      'insecure endpoint',
      'https://issuer.example.com',
      Response.json({
        issuer: 'https://issuer.example.com',
        authorization_endpoint: 'http://issuer.example.com/auth',
        token_endpoint: 'https://issuer.example.com/token',
        jwks_uri: 'https://issuer.example.com/keys',
      }),
    ],
  ] as const)('rejects %s before registration', async (_, issuer, doc) => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    if (doc) vi.mocked(fetch).mockResolvedValue(doc)
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerType: 'oidc',
          issuer,
          domain: 'example.com',
          providerId: 'okta',
          clientId: 'client',
          clientSecret: 'secret',
        }),
      })
    )
    expect(response.status).toBe(400)
    expect(fetch).toHaveBeenCalledTimes(doc ? 1 : 0)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })
  it('requires an IdP identity before saving a manual SAML provider', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerType: 'saml',
          issuer: 'https://studio.example.com',
          domain: 'example.com',
          providerId: 'okta-saml',
          entryPoint: 'https://idp.example.com/sso',
          cert: 'certificate',
        }),
      })
    )
    expect(response.status).toBe(400)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })
  it('verifies DNS and provisions the existing password user on signed OIDC login without billing', async () => {
    const origin = 'http://localhost:3000'
    const issuer = 'https://93.184.216.34'
    const email = 'member@example.com'
    const callbackURL = '/signup?complete=username&callbackUrl=%2Finvite%2Fteam'
    const memory = memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      organization: [],
      member: [],
      invitation: [],
      ssoProvider: [],
    })
    vi.mocked(drizzleAdapter).mockReturnValue(memory)
    const auth = betterAuth({
      baseURL: origin,
      secret: 'local-integration-test-secret-safe-for-fixtures-only',
      database: authDatabase,
      emailAndPassword: { enabled: true },
      plugins: [organization(), sso(ssoOptions)],
    })
    const api = (path: string, body?: object, cookie = '') =>
      auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { origin, cookie, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      )
    const cookies = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
    const ownerSignup = await api('/sign-up/email', {
      name: 'Owner',
      email: 'owner@example.com',
      password: 'Account-fixture-123!',
    })
    const cookie = cookies(ownerSignup)
    const { user: owner } = await ownerSignup.json()
    const { internalAdapter, adapter } = await auth.$context
    const org = await (
      await api('/organization/create', { name: 'Org', slug: 'org' }, cookie)
    ).json()
    const signup = await api('/sign-up/email', {
      name: 'Member',
      email,
      password: 'Account-fixture-123!',
    })
    const { user } = await signup.json()
    await internalAdapter.updateUser(user.id, { emailVerified: true })
    mockGetSession.mockResolvedValue({ user: owner, session: { activeOrganizationId: org.id } })
    mockRegisterSSOProvider.mockImplementation((options) => auth.api.registerSSOProvider(options))
    mockGetBillingGateState.mockResolvedValue({ billingEnabled: false })
    mockGetOrganizationSubscription.mockResolvedValue({ tier: null })
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: false,
      reason: 'No active subscription found',
    })

    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const subject = 'idp-member-1'
    const claims = { sub: subject, email, name: 'Member', email_verified: true }
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(issuer)
      .setAudience('client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    const discovery = vi.fn(() =>
      Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
      })
    )
    vi.mocked(fetch).mockImplementation(async (input) => {
      const { pathname } = new URL(String(input))
      if (pathname === '/.well-known/openid-configuration') return discovery()
      if (pathname === '/token')
        return Response.json({ token_type: 'Bearer', access_token: 'fixture', id_token: token })
      if (pathname === '/keys')
        return Response.json({ keys: [{ ...jwk, alg: 'RS256', kid: 'fixture' }] })
      throw new Error(`Unexpected fixture endpoint ${pathname}`)
    })

    const { POST } = await import('./route')
    const registration = await POST(
      new NextRequest(`${origin}/api/auth/sso/register`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: 'oidc',
          providerId: 'okta',
          issuer,
          domain: 'example.com',
          clientId: 'client',
          clientSecret: 'secret',
        }),
      })
    )
    expect(registration.status).toBe(200)
    const { domainVerificationToken } = await registration.json()
    expect(domainVerificationToken).toBeTruthy()
    const start = () => api('/sign-in/sso', { providerId: 'okta', callbackURL })
    expect((await start()).status).toBe(401)
    const txt = vi.spyOn(dns, 'resolveTxt').mockResolvedValue([[domainVerificationToken]])
    syncBuiltinESMExports()
    const verifyDomain = async () => {
      expect((await api('/sso/verify-domain', { providerId: 'okta' }, cookie)).status).toBe(204)
      expect(txt).toHaveBeenCalledWith('_better-auth-token-okta.example.com')
    }
    const complete = async () => {
      const started = await start()
      expect(started.status).toBe(200)
      const state = new URL((await started.json()).url).searchParams.get('state')
      const callback = await api(
        `/sso/callback/okta?${new URLSearchParams({ code: 'idp-code', state: state! })}`,
        undefined,
        cookies(started)
      )
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe(callbackURL)
      const session = await api('/get-session', undefined, cookies(callback))
      expect((await session.json()).user.id).toBe(user.id)
    }
    try {
      await verifyDomain()
      await complete()
      expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
      expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
      expect(
        await adapter.findOne({ model: 'member', where: [{ field: 'userId', value: user.id }] })
      ).toMatchObject({
        organizationId: org.id,
        role: 'member',
      })
      const accounts = await internalAdapter.findAccounts(user.id)
      expect(accounts.map((row) => row.providerId).sort()).toEqual(['credential', 'okta'])
      expect(accounts.find((row) => row.providerId === 'okta')?.accountId).toBe(subject)
      const where = [{ field: 'providerId', value: 'okta' }]
      const savedProvider = await adapter.findOne<{ id: string; oidcConfig: string }>({
        model: 'ssoProvider',
        where,
      })
      const config = JSON.parse(savedProvider!.oidcConfig)
      // 1.6.2 persisted this mapping and had no verified domain column.
      await adapter.update({
        model: 'ssoProvider',
        where,
        update: {
          domainVerified: null,
          oidcConfig: JSON.stringify({ ...config, mapping: { ...config.mapping, id: 'sub' } }),
        },
      })
      expect((await start()).status).toBe(401)
      const challenge = await api(
        '/sso/request-domain-verification',
        { providerId: 'okta' },
        cookie
      )
      txt.mockResolvedValue([[(await challenge.json()).domainVerificationToken]])
      await verifyDomain()
      await complete()
      expect((await internalAdapter.findAccounts(user.id)).map((row) => row.id).sort()).toEqual(
        accounts.map((row) => row.id).sort()
      )
      expect((await adapter.findOne<{ id: string }>({ model: 'ssoProvider', where }))?.id).toBe(
        savedProvider!.id
      )
      expect(await adapter.count({ model: 'user' })).toBe(2)
      expect(discovery).toHaveBeenCalledTimes(1)
    } finally {
      txt.mockRestore()
      syncBuiltinESMExports()
    }
  })
})
