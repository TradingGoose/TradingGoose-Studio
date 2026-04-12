/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetOrganizationBillingData,
  mockIsOrganizationOwnerOrAdmin,
  mockSelect,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetOrganizationBillingData: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockSelect: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
  ssoProvider: {
    id: 'sso_provider.id',
    providerId: 'sso_provider.provider_id',
    domain: 'sso_provider.domain',
    issuer: 'sso_provider.issuer',
    oidcConfig: 'sso_provider.oidc_config',
    samlConfig: 'sso_provider.saml_config',
    userId: 'sso_provider.user_id',
    organizationId: 'sso_provider.organization_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ kind: 'eq', args }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: (...args: unknown[]) => mockGetOrganizationBillingData(...args),
  isOrganizationOwnerOrAdmin: (...args: unknown[]) => mockIsOrganizationOwnerOrAdmin(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

describe('SSO providers route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockGetOrganizationBillingData.mockResolvedValue({
      subscriptionTier: {
        canConfigureSso: true,
      },
    })
  })

  it('returns active-organization providers for org admins on eligible tiers', async () => {
    const mockWhere = vi.fn().mockResolvedValue([
      {
        id: 'provider-1',
        providerId: 'okta',
        domain: 'example.com',
        issuer: 'https://issuer.example.com',
        oidcConfig: '{"clientId":"abc"}',
        samlConfig: null,
        organizationId: 'org-1',
      },
    ])

    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: mockWhere,
      })),
    })

    const { GET } = await import('./route')
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      providers: [
        {
          id: 'provider-1',
          providerId: 'okta',
          domain: 'example.com',
          issuer: 'https://issuer.example.com',
          organizationId: 'org-1',
          providerType: 'oidc',
          hasOidcConfig: true,
          hasSamlConfig: false,
        },
      ],
    })
    expect(payload.providers[0]).not.toHaveProperty('oidcConfig')
    expect(payload.providers[0]).not.toHaveProperty('samlConfig')
    expect(mockIsOrganizationOwnerOrAdmin).toHaveBeenCalledWith('user-1', 'org-1')
    expect(mockGetOrganizationBillingData).toHaveBeenCalledWith('org-1')
    expect(mockWhere).toHaveBeenCalledWith({
      kind: 'eq',
      args: ['sso_provider.organization_id', 'org-1'],
    })
  })

  it('requires an active organization for authenticated management requests', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: null,
      },
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Active organization is required',
    })
    expect(mockSelect).not.toHaveBeenCalled()
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

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Only organization owners and admins can manage SSO',
    })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('rejects organizations whose tier cannot configure sso', async () => {
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
        canConfigureSso: false,
      },
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Single Sign-On is not enabled for this organization',
    })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('keeps unauthenticated requests limited to domain discovery for sign-in', async () => {
    mockGetSession.mockResolvedValue(null)
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([
        {
          domain: 'enabled.example.com',
        },
      ]),
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          domain: 'enabled.example.com',
        },
      ],
    })
    expect(mockIsOrganizationOwnerOrAdmin).not.toHaveBeenCalled()
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
  })

  it('classifies saml-only providers correctly for org-owned providers', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
      session: {
        activeOrganizationId: 'org-1',
      },
    })
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([
          {
            id: 'provider-1',
            providerId: 'okta-saml',
            domain: 'example.com',
            issuer: 'https://issuer.example.com',
            oidcConfig: null,
            samlConfig: '{"entryPoint":"https://idp.example.com"}',
            organizationId: 'org-1',
          },
        ]),
      })),
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    const payload = await response.json()

    expect(payload).toEqual({
      providers: [
        expect.objectContaining({
          providerId: 'okta-saml',
          providerType: 'saml',
          hasOidcConfig: false,
          hasSamlConfig: true,
        }),
      ],
    })
    expect(payload.providers[0]).not.toHaveProperty('oidcConfig')
    expect(payload.providers[0]).not.toHaveProperty('samlConfig')
  })
})
