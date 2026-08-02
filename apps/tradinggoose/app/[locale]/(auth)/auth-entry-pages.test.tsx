import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthErrorCallbackPath } from '@/lib/auth/auth-error-copy'

const mockGetLocale = vi.fn()
const mockGetSession = vi.fn()
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})
const mockGetBrandConfig = vi.fn()
const mockGetOAuthProviderStatus = vi.fn()
const mockGetRegistrationModeForRender = vi.fn()

vi.mock('next-intl/server', () => ({
  getLocale: () => mockGetLocale(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/branding/branding', () => ({
  getBrandConfig: () => mockGetBrandConfig(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode
    href: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  redirect: ({ href, locale }: { href: string; locale?: string }) => {
    const localizedPath = locale && href.startsWith('/') ? `/${locale}${href}` : href
    return mockRedirect(localizedPath)
  },
}))

vi.mock('@/app/(auth)/components/oauth-provider-checker', () => ({
  getOAuthProviderStatus: () => mockGetOAuthProviderStatus(),
}))

vi.mock('@/lib/registration/service', () => ({
  getRegistrationModeForRender: () => mockGetRegistrationModeForRender(),
}))

vi.mock('@/app/(auth)/components/auth-page-header', () => ({
  AuthPageHeader: () => null,
}))

vi.mock('@/app/(auth)/login/login-form', () => ({
  default: ({ registrationMode }: { registrationMode: string }) => (
    <div data-testid='login-form' data-registration-mode={registrationMode} />
  ),
}))

vi.mock('@/app/(auth)/signup/signup-form', () => ({
  default: ({ registrationMode }: { registrationMode: string }) => (
    <div data-testid='signup-form' data-registration-mode={registrationMode} />
  ),
}))

describe('localized auth entry pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetLocale.mockResolvedValue('es')
    mockGetSession.mockResolvedValue(null)
    mockGetOAuthProviderStatus.mockResolvedValue({
      githubAvailable: false,
      googleAvailable: false,
      isProduction: false,
    })
    mockGetRegistrationModeForRender.mockResolvedValue('open')
    mockGetBrandConfig.mockReturnValue({ supportEmail: 'support@tradinggoose.ai' })
  })

  it('redirects login to the localized workspace when a session is present', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })

    const LoginPage = (await import('./login/page')).default

    await expect(LoginPage()).rejects.toThrow('redirect:/es/workspace')
    expect(mockGetSession).toHaveBeenCalledWith()
    expect(mockGetOAuthProviderStatus).not.toHaveBeenCalled()
    expect(mockGetRegistrationModeForRender).not.toHaveBeenCalled()
  })

  it('renders login reauth routes without redirecting an existing session first', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })

    const LoginPage = (await import('./login/page')).default

    const result = await LoginPage({ searchParams: Promise.resolve({ reauth: '1' }) })
    const markup = renderToStaticMarkup(result)

    expect(markup).toContain('data-testid="login-form"')
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('renders login when the session check is empty', async () => {
    const LoginPage = (await import('./login/page')).default

    const result = await LoginPage()
    const markup = renderToStaticMarkup(result)

    expect(markup).toContain('data-testid="login-form"')
    expect(markup).toContain('data-registration-mode="open"')
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('redirects signup to the localized workspace when a session is present', async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-1',
      },
    })

    const SignupPage = (await import('./signup/page')).default

    await expect(SignupPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/es/workspace'
    )
    expect(mockGetSession).toHaveBeenCalledWith()
    expect(mockGetOAuthProviderStatus).not.toHaveBeenCalled()
    expect(mockGetRegistrationModeForRender).not.toHaveBeenCalled()
  })

  it('renders signup when the session check is empty', async () => {
    const SignupPage = (await import('./signup/page')).default

    const result = await SignupPage({ searchParams: Promise.resolve({}) })
    const markup = renderToStaticMarkup(result)

    expect(markup).toContain('data-testid="signup-form"')
    expect(markup).toContain('data-registration-mode="open"')
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('keeps provider error callback state in the per-flow error URL', async () => {
    const callbackPath = getAuthErrorCallbackPath('/invite/invitation-1?token=workspace-token')
    const ErrorPage = (await import('./error/[[...callback]]/page')).default

    const result = await ErrorPage({
      params: Promise.resolve({
        callback: callbackPath?.split('/').filter(Boolean).slice(1),
      }),
      searchParams: Promise.resolve({ error: 'UNABLE_TO_CREATE_SESSION' }),
    })
    const markup = renderToStaticMarkup(result)

    expect(markup).toContain(
      'href="/login?reauth=1&amp;callbackUrl=%2Finvite%2Finvitation-1%3Ftoken%3Dworkspace-token"'
    )
    expect(markup).toContain('href="/"')
    expect(markup).toContain('Volver a iniciar sesión')
    expect(markup).toContain('Volver al inicio')
    expect(markup).toContain('bg-primary')
    expect(markup).toContain('border-input')
    expect(markup).not.toContain('role="button"')
    expect(markup).not.toContain('tabindex=')
    expect(markup).not.toContain('document.cookie')
  })
})
