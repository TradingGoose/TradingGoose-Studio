/**
 * @vitest-environment node
 */

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
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/security/input-validation', () => ({
  validateExternalUrl: vi.fn(() => ({ isValid: true })),
}))

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
    expect(fetch).toHaveBeenCalledWith(
      'https://issuer.example.com/.well-known/openid-configuration',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      })
    )
    expect(mockRegisterSSOProvider).toHaveBeenCalledWith({
      body: expect.objectContaining({
        providerId: 'okta',
        domain: 'example.com',
        organizationId: 'org-1',
        oidcConfig: expect.objectContaining({
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

  it('registers saml providers for the active organization with a computed callback url', async () => {
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
          callbackUrl: 'https://issuer.example.com/callback/okta-saml',
        }),
      }),
      headers: expect.objectContaining({
        'content-type': 'application/json',
      }),
    })
  })
})
