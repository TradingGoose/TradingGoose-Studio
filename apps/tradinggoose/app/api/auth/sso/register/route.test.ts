/**
 * @vitest-environment node
 */

import { inflateRawSync } from 'node:zlib'
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

// Public IdP certificate from Better Auth v1.6.34 packages/sso/src/saml.test.ts.
const certificate = `-----BEGIN CERTIFICATE-----
MIIDlzCCAn+gAwIBAgIJAO1ymQc33+bWMA0GCSqGSIb3DQEBCwUAMGIxCzAJBgNV
BAYTAkhLMRMwEQYDVQQIDApTb21lLVN0YXRlMRowGAYDVQQKDBFJZGVudGl0eSBQ
cm92aWRlcjEUMBIGA1UECwwLRGV2ZWxvcG1lbnQxDDAKBgNVBAMMA0lEUDAeFw0x
NTA3MDUxODAyMjdaFw0xODA3MDQxODAyMjdaMGIxCzAJBgNVBAYTAkhLMRMwEQYD
VQQIDApTb21lLVN0YXRlMRowGAYDVQQKDBFJZGVudGl0eSBQcm92aWRlcjEUMBIG
A1UECwwLRGV2ZWxvcG1lbnQxDDAKBgNVBAMMA0lEUDCCASIwDQYJKoZIhvcNAQEB
BQADggEPADCCAQoCggEBAODZsWhCe+yG0PalQPTUoD7yko5MTWMCRxJ8hSm2k7mG
3Eg/Y2v0EBdCmTw7iDCevRqUmbmFnq7MROyV4eriJzh0KabAdZf7/k6koghst3ZU
tWOwzshyxkBtWDwGmBpQGTGsKxJ8M1js3aSqNRXBT4OBWM9w2Glt1+8ty30RhYv3
pSF+/HHLH7Ac+vLSIAlokaFW34RWTcJ/8rADuRWlXih4GfnIu0W/ncm5nTSaJiRA
vr3dGDRO/khiXoJdbbOj7dHPULxVGbH9IbPK76TCwLbF7ikIMsPovVbTrpyL6vsb
VUKeEl/5GKppTwp9DLAOeoSYpCYkkDkYKu9TRQjF02MCAwEAAaNQME4wHQYDVR0O
BBYEFP2ut2AQdy6D1dwdwK740IHmbh38MB8GA1UdIwQYMBaAFP2ut2AQdy6D1dwd
wK740IHmbh38MAwGA1UdEwQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBANMZUoPN
mHzgja2PYkbvBYMHmpvUkVoiuvQ9cJPlqGTB2CRfG68BNNs/Clz8P7cIrAdkhCUw
i1rSBhDuslGFNrSaIpv6B10FpBuKwef3G7YrPWFNEN6khY7aHNWSTHqKgs1DrGef
2B9hvkrnHWbQVSVXrBFKe1wTCqcgGcOpYoSK7L8C6iX6uIA/uZYnVQ4NgBrizJ0a
zkjdegz3hwO/gt4malEURy8D85/AAVt6PAzhpb9VJUGxSXr/EfntVUEz3L2gUFWW
k1CnZFyz0rIOEt/zPmeAY8BLyd/Tjxm4Y+gwNazKq5y9AJS+m858b/nM4QdCnUE4
yyoWAJDUHiAmvFA=
-----END CERTIFICATE-----`

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
      scopes: ['openid', 'profile', 'email', 'offline_access'],
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

  it.each([
    {
      providerType: 'oidc',
      config: {
        clientId: 'client-id',
        clientSecret: 'secret',
        authorizationEndpoint: 'https://issuer.example.com/authorize',
      },
      code: 'unrecognized_keys',
    },
    {
      providerType: 'saml',
      config: {
        entryPoint: 'https://issuer.example.com/saml',
        cert: 'certificate',
        clientId: 'unsupported',
      },
      code: 'unrecognized_keys',
    },
    {
      providerType: 'oidc',
      config: { clientId: 'client-id', clientSecret: 'secret', scopes: 'openid,profile,email' },
      code: 'invalid_type',
    },
    ...[45, 47].flatMap((length) => [
      {
        providerType: 'oidc',
        config: { providerId: 'x'.repeat(length), clientId: 'client-id', clientSecret: 'secret' },
        code: 'too_big',
      },
      {
        providerType: 'saml',
        config: {
          providerId: 'x'.repeat(length),
          entryPoint: 'https://issuer.example.com/saml',
          cert: 'certificate',
        },
        code: 'too_big',
      },
    ]),
  ])(
    'rejects unsupported $providerType registration input with $code before discovery',
    async ({ providerType, config, code }) => {
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
            providerType,
            ...config,
          }),
          headers: {
            'content-type': 'application/json',
          },
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: expect.any(String),
      })
      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid SSO registration request', {
        errors: expect.arrayContaining([expect.objectContaining({ code })]),
      })
      expect(fetch).not.toHaveBeenCalled()
      expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
    }
  )

  it('registers a 44-character OIDC provider via issuer discovery', async () => {
    const providerId = 'x'.repeat(44)
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
        providerId,
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
      headers: expect.any(Headers),
    })
    expect(mockIsOrganizationOwnerOrAdmin).toHaveBeenCalledWith('user-1', 'org-1')
  })

  it('registers a 44-character SAML provider with Better Auth ACS callback URL', async () => {
    const providerId = 'x'.repeat(44)
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

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/auth/sso/register', {
        method: 'POST',
        body: JSON.stringify({
          providerId,
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
        providerId,
        organizationId: 'org-1',
        samlConfig: expect.objectContaining({
          callbackUrl: `http://localhost:3000/api/auth/sso/saml2/sp/acs/${providerId}`,
        }),
      }),
      headers: expect.any(Headers),
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
      scopes: ['openid', 'profile', 'email'],
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksEndpoint: `${issuer}/jwks`,
    })
  })

  it('lets native SAML generate SP metadata and an AuthnRequest for the registered ACS', async () => {
    const baseURL = 'http://localhost:3000'
    const issuer = 'https://idp.example.com'
    const providerId = 'okta-saml'
    const nativeAuth = betterAuth({
      baseURL,
      secret: 'saml-registration-integration-secret-long-enough',
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
    headers.set('content-type', 'application/json')
    headers.set('origin', baseURL)
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(`${baseURL}/api/auth/sso/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          providerId,
          issuer,
          domain: 'example.com',
          providerType: 'saml',
          entryPoint: `${issuer}/sso`,
          cert: certificate,
          wantAssertionsSigned: true,
        }),
      })
    )
    expect(response.status).toBe(200)
    const stored = await context.adapter.findOne<{ samlConfig: string }>({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
    })
    expect(JSON.parse(stored!.samlConfig).spMetadata).toEqual({})
    expect(JSON.parse(stored!.samlConfig).wantAssertionsSigned).toBe(true)
    const metadata = await nativeAuth.api.spMetadata({
      query: { providerId, format: 'xml' },
      asResponse: true,
    })
    const xml = await metadata.text()
    const callbackUrl = `${baseURL}/api/auth/sso/saml2/sp/acs/${providerId}`
    expect(xml).toContain(`entityID="${issuer}"`)
    expect(xml).toContain(`Location="${callbackUrl}"`)
    const login = await nativeAuth.api.signInSSO({
      body: { providerId, callbackURL: `${baseURL}/workspace` },
    })
    const request = new URL(login.url)
    expect(request.origin + request.pathname).toBe(`${issuer}/sso`)
    const authn = inflateRawSync(
      Buffer.from(request.searchParams.get('SAMLRequest')!, 'base64')
    ).toString()
    expect(authn).toContain(`AssertionConsumerServiceURL="${callbackUrl}"`)
    expect(authn).toContain(issuer)
  })
})
