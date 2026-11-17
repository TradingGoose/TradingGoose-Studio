/** @vitest-environment jsdom */

import type React from 'react'
import { act, Suspense, startTransition } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const mockUseOrganizations = vi.fn()
const mockUseOrganizationBilling = vi.fn()
const mockRequestDomainVerification = vi.fn()
const mockVerifyDomain = vi.fn()

vi.mock('@/components/ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string }) => <button {...props} />,
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  Label: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>loading</div>,
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
  client: {
    sso: {
      requestDomainVerification: (...args: unknown[]) => mockRequestDomainVerification(...args),
      verifyDomain: (...args: unknown[]) => mockVerifyDomain(...args),
    },
  },
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

  describe('native domain verification controls', () => {
    let root: Root
    let container: HTMLDivElement
    const provider = {
      id: 'provider-1',
      providerId: 'okta',
      domain: 'example.com',
      domainVerified: false,
      issuer: 'https://idp.example.com',
      providerType: 'oidc',
    }
    const reactEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    let previousActEnvironment: boolean | undefined
    function setOrganization(id: string) {
      mockUseOrganizations.mockReturnValue({
        data: {
          activeOrganization: {
            id,
            members: [{ role: 'admin', user: { email: 'member@example.com' } }],
          },
        },
      })
    }
    beforeEach(() => {
      previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT
      reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
      setOrganization('org-1')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [provider] }) })
      )
      mockRequestDomainVerification
        .mockReset()
        .mockResolvedValue({ data: { domainVerificationToken: 'dns-token' }, error: null })
      mockVerifyDomain.mockReset().mockResolvedValue({ data: null, error: null })
      container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
    })
    afterEach(() => {
      act(() => root.unmount())
      container.remove()
      reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      vi.unstubAllGlobals()
    })
    async function renderSettings() {
      const { SSO } = await import('./sso')
      await act(async () => root.render(<SSO />))
    }
    async function click(label: string) {
      const button = [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label
      )
      expect(button).toBeDefined()
      await act(async () => button!.click())
    }

    it.each([44, 45, 47])(
      'validates a %i-character provider ID before registration',
      async (length) => {
        vi.mocked(fetch).mockResolvedValue({
          ok: true,
          json: async () => ({ providers: [] }),
        } as Response)
        await renderSettings()
        const providerId = 'p'.repeat(length)
        const select = container.querySelector<HTMLSelectElement>('#provider-id')!
        select.append(new Option(providerId, providerId))
        await act(async () => {
          select.value = providerId
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        for (const [id, value] of [
          ['issuer-url', 'https://idp.example.com'],
          ['domain', 'example.com'],
          ['client-id', 'client-id'],
          ['client-secret', 'client-secret'],
        ]) {
          await act(async () => {
            const input = container.querySelector<HTMLInputElement>(`#${id}`)!
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              input,
              value
            )
            input.dispatchEvent(new Event('input', { bubbles: true }))
          })
        }
        const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        expect(submit.disabled).toBe(length > 44)
        if (length === 44) {
          await click('Configure SSO Provider')
          expect(fetch).toHaveBeenCalledWith('/api/auth/sso/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providerId,
              issuer: 'https://idp.example.com',
              domain: 'example.com',
              providerType: 'oidc',
              clientId: 'client-id',
              clientSecret: 'client-secret',
              scopes: ['openid', 'profile', 'email'],
            }),
          })
        } else {
          await act(async () => {
            container
              .querySelector('form')!
              .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          })
          expect(container.textContent).toContain('Provider ID must be at most 44 characters.')
          expect(fetch).not.toHaveBeenCalledWith('/api/auth/sso/register', expect.anything())
        }
      }
    )

    it('requests native proof and lets failed request or DNS verification be retried', async () => {
      await renderSettings()
      expect(container.textContent).toContain('Domain verification required before sign-in')
      mockRequestDomainVerification.mockResolvedValueOnce({ error: { message: 'Request failed' } })
      await click('Get DNS record')
      expect(container.textContent).toContain('Request failed')
      await click('Get DNS record')
      expect(mockRequestDomainVerification).toHaveBeenLastCalledWith({ providerId: 'okta' })
      expect(container.querySelector<HTMLInputElement>('#dns-name-provider-1')?.value).toBe(
        '_better-auth-token-okta.example.com'
      )
      expect(container.querySelector<HTMLInputElement>('#dns-value-provider-1')?.value).toBe(
        'dns-token'
      )
      mockVerifyDomain.mockResolvedValueOnce({ error: { message: 'DNS not found' } })
      await click('Verify domain')
      expect(container.textContent).toContain('DNS not found')
      expect(container.textContent).not.toContain('Domain verified')
      await click('Refresh DNS record')
      await click('Verify domain')
      expect(mockVerifyDomain).toHaveBeenLastCalledWith({ providerId: 'okta' })
      expect(container.textContent).toContain('Domain verified')
      expect(container.textContent).not.toContain('Verify domain')
      expect(container.textContent).not.toContain('Refresh DNS record')
    })

    it('keeps verified providers free of proof controls after loading', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ ...provider, domainVerified: true }] }),
      } as Response)
      await renderSettings()
      expect(container.textContent).toContain('Domain verified')
      expect(container.textContent).not.toContain('Get DNS record')
    })

    it('shows one native TXT host per configured domain with a shared verification value', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          providers: [{ ...provider, domain: 'company.com, subsidiary.com, ' }],
        }),
      } as Response)
      await renderSettings()
      await click('Get DNS record')
      expect(container.querySelector<HTMLInputElement>('#dns-name-provider-1')?.value).toBe(
        '_better-auth-token-okta.company.com'
      )
      expect(container.querySelector<HTMLInputElement>('#dns-name-provider-1-1')?.value).toBe(
        '_better-auth-token-okta.subsidiary.com'
      )
      expect(container.querySelector<HTMLInputElement>('#dns-value-provider-1')?.value).toBe(
        'dns-token'
      )
      expect(container.querySelectorAll('input[id^="dns-name-"]')).toHaveLength(2)
      await click('Verify domain')
      expect(mockVerifyDomain).toHaveBeenCalledExactlyOnceWith({ providerId: 'okta' })
    })

    it.each(['request', 'verify'] as const)(
      'ignores a stale %s result after switching organizations and back',
      async (action) => {
        await renderSettings()
        if (action === 'verify') await click('Get DNS record')
        let finish!: () => void
        const pending = action === 'request' ? mockRequestDomainVerification : mockVerifyDomain
        pending.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () =>
                resolve({
                  data: action === 'request' ? { domainVerificationToken: 'stale-token' } : null,
                  error: null,
                })
            })
        )
        await click(action === 'request' ? 'Get DNS record' : 'Verify domain')
        setOrganization('org-2')
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            providers: [{ ...provider, id: 'provider-2', providerId: 'azure-ad' }],
          }),
        } as Response)
        await renderSettings()
        expect(container.textContent).toContain('azure-ad')
        setOrganization('org-1')
        await renderSettings()
        await act(async () => finish())
        expect(container.textContent).not.toContain('Domain verified')
        expect(container.querySelector('#dns-value-provider-1')).toBeNull()
        expect(
          [...container.querySelectorAll('button')].find(
            (button) => button.textContent === 'Get DNS record'
          )?.disabled
        ).toBe(false)
      }
    )

    it('retains the committed verification scope when an organization transition is abandoned', async () => {
      const { SSO } = await import('./sso')
      let finish!: () => void
      mockRequestDomainVerification.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({ data: { domainVerificationToken: 'committed-token' }, error: null })
          })
      )
      let suspend = false
      let attempted = false
      const blocked = new Promise<void>(() => {})
      function PendingOrganization() {
        if (suspend) {
          attempted = true
          throw blocked
        }
        return null
      }
      function Settings() {
        return (
          <Suspense fallback={<div>loading organization</div>}>
            <SSO />
            <PendingOrganization />
          </Suspense>
        )
      }
      await act(async () => root.render(<Settings />))
      await click('Get DNS record')
      setOrganization('org-2')
      suspend = true
      await act(async () => startTransition(() => root.render(<Settings />)))
      expect(attempted).toBe(true)
      setOrganization('org-1')
      suspend = false
      await act(async () => root.render(<Settings />))
      await act(async () => finish())
      expect(container.querySelector<HTMLInputElement>('#dns-value-provider-1')?.value).toBe(
        'committed-token'
      )
    })
  })
})
