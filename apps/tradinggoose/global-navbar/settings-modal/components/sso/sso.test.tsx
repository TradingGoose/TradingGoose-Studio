import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const mockUseOrganizations = vi.fn()
const mockUseOrganizationBilling = vi.fn()

vi.mock('@/components/ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  Label: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>loading</div>,
}))

vi.mock('@/lib/auth-client', () => ({
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
})
