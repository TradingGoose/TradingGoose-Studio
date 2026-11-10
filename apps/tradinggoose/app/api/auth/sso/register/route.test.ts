/**
 * @vitest-environment node
 */

import { sso } from '@better-auth/sso'
import { betterAuth } from 'better-auth'
import { organization, testUtils } from 'better-auth/plugins'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRegisterSSOProvider,
  mockIsOrganizationOwnerOrAdmin,
  mockGetOrganizationBillingData,
  mockGetBillingGateState,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockGetOrganizationBillingData: vi.fn(),
  mockGetBillingGateState: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
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
  getOrganizationBillingData: (...args: unknown[]) => mockGetOrganizationBillingData(...args),
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

vi.mock('@/lib/security/input-validation', () => ({
  validateExternalUrl: vi.fn(() => ({ isValid: true })),
}))

function oidcRegistrationRequest(headers: HeadersInit = { 'content-type': 'application/json' }) {
  return new NextRequest('http://localhost:3000/api/auth/sso/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      providerId: 'okta',
      issuer: 'https://issuer.example.com',
      domain: 'example.com',
      providerType: 'oidc',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    }),
  })
}

describe('SSO register route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockGetBillingGateState.mockResolvedValue({ billingEnabled: true })
    mockGetOrganizationBillingData.mockResolvedValue({
      subscriptionTier: {
        ownerType: 'organization',
        canConfigureSso: true,
      },
    })
    vi.stubGlobal('fetch', vi.fn())
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
    mockGetOrganizationBillingData.mockResolvedValue({
      subscriptionTier: {
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
    mockGetOrganizationBillingData.mockResolvedValue({
      subscriptionTier: null,
    })
    mockRegisterSSOProvider.mockResolvedValue({
      providerId: 'okta',
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://issuer.example.com',
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

  it('registers oidc providers for the active organization via issuer discovery', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockRegisterSSOProvider.mockResolvedValue({
      providerId: 'okta',
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://issuer.example.com',
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
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://issuer.example.com/.well-known/openid-configuration'
    )
    expect(mockRegisterSSOProvider).toHaveBeenCalledWith({
      body: expect.objectContaining({
        providerId: 'okta',
        domain: 'example.com',
        organizationId: 'org-1',
        oidcConfig: expect.objectContaining({
          skipDiscovery: true,
          authorizationEndpoint: 'https://issuer.example.com/oauth2/v1/authorize',
          tokenEndpoint: 'https://issuer.example.com/oauth2/v1/token',
          userInfoEndpoint: 'https://issuer.example.com/oauth2/v1/userinfo',
          jwksEndpoint: 'https://issuer.example.com/oauth2/v1/keys',
          mapping: {
            id: 'sub',
            email: 'email',
            name: 'name',
            image: 'picture',
          },
        }),
      }),
      headers: expect.objectContaining({
        'content-type': 'application/json',
      }),
    })
    expect(mockIsOrganizationOwnerOrAdmin).toHaveBeenCalledWith('user-1', 'org-1')
  })

  it('registers saml providers for the active organization with Better Auth ACS callback url', async () => {
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
          callbackUrl: 'http://localhost:3000/api/auth/sso/saml2/sp/acs/okta-saml',
        }),
      }),
      headers: expect.objectContaining({
        'content-type': 'application/json',
      }),
    })
  })

  it('applies the existing external URL policy before discovery or native registration', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'owner' },
      session: { activeOrganizationId: 'org-1' },
    })
    const { validateExternalUrl } = await import('@/lib/security/input-validation')
    vi.mocked(validateExternalUrl).mockReturnValueOnce({ isValid: false, error: 'Blocked URL' })
    const { POST } = await import('./route')
    const response = await POST(oidcRegistrationRequest())
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects discovery documents whose issuer differs from the requested provider', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'owner' },
      session: { activeOrganizationId: 'org-1' },
    })
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        issuer: 'https://different.example.com',
        authorization_endpoint: 'https://issuer.example.com/authorize',
        token_endpoint: 'https://issuer.example.com/token',
        jwks_uri: 'https://issuer.example.com/jwks',
      })
    )
    const { POST } = await import('./route')
    const response = await POST(oidcRegistrationRequest())
    expect(response.status).toBe(400)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('registers discovered external OIDC endpoints natively without adding trusted origins', async () => {
    const baseURL = 'http://localhost:3000'
    const issuer = 'https://issuer.example.com'
    const nativeAuth = betterAuth({
      baseURL,
      secret: 'sso-registration-integration-secret-long-enough',
      trustedOrigins: [baseURL],
      plugins: [sso(), organization(), testUtils()],
    })
    const context = await nativeAuth.$context
    await context.test.saveUser(
      context.test.createUser({ id: 'owner', email: 'owner@example.com' })
    )
    const { headers } = await context.test.login({ userId: 'owner' })
    const org = await nativeAuth.api.createOrganization({
      headers,
      body: { name: 'Example', slug: 'example' },
    })
    await nativeAuth.api.setActiveOrganization({ headers, body: { organizationId: org!.id } })
    mockGetSession.mockImplementation((requestHeaders) =>
      nativeAuth.api.getSession({ headers: requestHeaders })
    )
    mockRegisterSSOProvider.mockImplementation((input) => nativeAuth.api.registerSSOProvider(input))
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      })
    )
    headers.set('content-type', 'application/json')
    headers.set('origin', baseURL)

    const { POST } = await import('./route')
    const response = await POST(oidcRegistrationRequest(headers))

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const stored = await context.adapter.findOne<{ oidcConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: 'okta' }],
    })
    expect(stored).toMatchObject({
      providerId: 'okta',
      organizationId: org!.id,
    })
    expect(JSON.parse(stored!.oidcConfig)).toMatchObject({
      tokenEndpointAuthentication: 'client_secret_post',
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksEndpoint: `${issuer}/jwks`,
    })
  })
})
