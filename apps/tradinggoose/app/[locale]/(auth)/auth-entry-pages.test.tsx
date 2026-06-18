import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetLocale = vi.fn()
const mockGetSession = vi.fn()
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})
const mockGetOAuthProviderStatus = vi.fn()
const mockGetRegistrationModeForRender = vi.fn()

vi.mock('next-intl/server', () => ({
  getLocale: () => mockGetLocale(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
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
})
