/** @vitest-environment jsdom */

import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verification = vi.hoisted(() => ({
  requestDomainVerification: vi.fn(),
  verifyDomain: vi.fn(),
}))
const mockUseSession = vi.fn()
const mockUseOrganizations = vi.fn()
const mockUseOrganizationBilling = vi.fn()

vi.mock('@/components/ui', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>loading</div>,
}))

vi.mock('@/lib/auth-client', () => ({
  client: { sso: verification },
  useSession: () => mockUseSession(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'https://example.com',
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizations: () => mockUseOrganizations(),
  useOrganizationBilling: () => mockUseOrganizationBilling(),
}))

describe('SSO access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'member@example.com',
        },
      },
    })
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: {
          id: 'org-1',
          members: [
            {
              role: 'member',
              user: {
                email: 'member@example.com',
              },
            },
          ],
        },
      },
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: {
        billingEnabled: true,
        subscriptionTier: {
          ownerType: 'organization',
          canConfigureSso: true,
        },
      },
    })
  })

  it('blocks non-admin org members from the self-hosted org SSO surface', async () => {
    const { SSO } = await import('./sso')
    const markup = renderToStaticMarkup(<SSO />)

    expect(markup).toContain(
      'Only organization owners and admins can configure Single Sign-On settings.'
    )
    expect(markup).not.toContain('Only the user who configured SSO can manage these settings.')
  })

  it('requires an active organization instead of falling back to personal SSO management', async () => {
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: null,
      },
    })

    const { SSO } = await import('./sso')
    const markup = renderToStaticMarkup(<SSO />)

    expect(markup).toContain('You must be part of an organization to configure Single Sign-On.')
    expect(markup).not.toContain('Only the user who configured SSO can manage these settings.')
  })

  it('blocks org admins when the current billing tier cannot configure SSO', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
        },
      },
    })
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: {
          id: 'org-1',
          members: [
            {
              role: 'admin',
              user: {
                email: 'admin@example.com',
              },
            },
          ],
        },
      },
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: {
        billingEnabled: true,
        subscriptionTier: {
          ownerType: 'organization',
          canConfigureSso: false,
        },
      },
    })

    const { SSO } = await import('./sso')
    const markup = renderToStaticMarkup(<SSO />)

    expect(markup).toContain('Single Sign-On is not enabled for this billing tier.')
  })

  it('keeps org-admin SSO settings available when billing is disabled', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
        },
      },
    })
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: {
          id: 'org-1',
          members: [
            {
              role: 'admin',
              user: {
                email: 'admin@example.com',
              },
            },
          ],
        },
      },
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: {
        billingEnabled: false,
        subscriptionTier: null,
      },
    })

    const { SSO } = await import('./sso')
    const markup = renderToStaticMarkup(<SSO />)

    expect(markup).not.toContain('Single Sign-On is not enabled for this billing tier.')
    expect(markup).not.toContain(
      'Only organization owners and admins can configure Single Sign-On settings.'
    )
  })
  it('lets an owner retrieve the TXT value for every pending domain and verify the connection', async () => {
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: {
          id: 'org-1',
          members: [{ role: 'owner', user: { email: 'member@example.com' } }],
        },
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          providers: [
            {
              id: 'connection',
              providerId: 'okta',
              domain: 'example.com,example.org',
              issuer: 'https://idp.example.com',
              providerType: 'oidc',
              domainVerified: false,
            },
          ],
        })
      )
    )
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    verification.requestDomainVerification.mockResolvedValue({
      data: { domainVerificationToken: 'fixture-dns-token' },
    })
    verification.verifyDomain.mockResolvedValue({ error: null })
    const container = document.createElement('div')
    const root = createRoot(container)
    const { SSO } = await import('./sso')
    const click = async (name: string) => {
      const button = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === name
      )
      expect(button).toBeDefined()
      await act(async () => button!.click())
    }
    try {
      await act(async () => root.render(<SSO />))
      expect(container.textContent).toContain('Domain verification required')
      expect(container.textContent).toContain('_better-auth-token-okta.example.com')
      expect(container.textContent).toContain('_better-auth-token-okta.example.org')
      await click('Get verification token')
      expect(container.textContent).toContain('fixture-dns-token')
      expect(verification.requestDomainVerification).toHaveBeenCalledWith({ providerId: 'okta' })
      await click('Verify domain')
      expect(verification.verifyDomain).toHaveBeenCalledWith({ providerId: 'okta' })
      expect(container.textContent).toContain('Domain verified')
      expect(container.textContent).not.toContain('fixture-dns-token')
    } finally {
      await act(async () => root.unmount())
      vi.unstubAllGlobals()
    }
  })
})
