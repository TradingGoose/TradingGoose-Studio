/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import LoginPage from './login/login-form'
import SignupPage from './signup/signup-form'
import { VerifyContent } from './verify/verify-content'

const mockPush = vi.hoisted(() => vi.fn())
const mockSignUpEmail = vi.hoisted(() => vi.fn())
const mockSignInEmail = vi.hoisted(() => vi.fn())
const mockSignOut = vi.hoisted(() => vi.fn())
const mockSendVerificationOtp = vi.hoisted(() => vi.fn())
const mockRefetchSession = vi.hoisted(() => vi.fn())
const mockUseVerification = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())
const testState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => testState.searchParams.get(key),
  }),
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
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/login',
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signUp: {
      email: mockSignUpEmail,
    },
    signIn: {
      email: mockSignInEmail,
    },
    signOut: mockSignOut,
    emailOtp: {
      sendVerificationOtp: mockSendVerificationOtp,
    },
  },
  useSession: () => ({
    refetch: mockRefetchSession,
  }),
}))

vi.mock('@/app/(auth)/verify/use-verification', () => ({
  useVerification: mockUseVerification,
}))

vi.mock('@/app/(auth)/components/social-login-buttons', () => ({
  SocialLoginButtons: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/(auth)/components/sso-login-button', () => ({
  SSOLoginButton: () => null,
}))

vi.mock('@/app/(auth)/components/auth-page-header', () => ({
  AuthPageHeader: () => null,
}))

vi.mock('@/app/(auth)/components/auth-waitlist-note', () => ({
  AuthWaitlistNote: () => null,
}))

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: '' },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode
  }) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement> & {
    children?: React.ReactNode
  }) => (
    <label {...props} htmlFor={props.htmlFor ?? 'test-field'}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  InputOTPGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  InputOTPSlot: ({ index }: { index: number }) => <div data-index={index} />,
}))

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    EMAIL_VERIFICATION_ENABLED: false,
  },
  getEnv: vi.fn(() => undefined),
  isTruthy: vi.fn(() => false),
}))

describe('auth locale redirects', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    testState.searchParams = new URLSearchParams()
    mockPush.mockReset()
    mockSignUpEmail.mockReset()
    mockSignInEmail.mockReset()
    mockSignOut.mockReset()
    mockSendVerificationOtp.mockReset()
    mockRefetchSession.mockReset()
    mockUseVerification.mockReset()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    global.fetch = mockFetch
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderWithLocale(locale: 'en' | 'es' | 'zh', element: React.ReactElement) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          {element}
        </NextIntlClientProvider>
      )
    })
  }

  async function setInputValue(selector: string, value: string) {
    const input = container.querySelector(selector)

    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Expected input ${selector} to render`)
    }

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)

    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  async function submitRenderedForm() {
    const form = container.querySelector('form')

    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Expected auth form to render')
    }

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  async function renderLogin(locale: 'en' | 'es' | 'zh' = 'en') {
    await renderWithLocale(
      locale,
      <LoginPage
        githubAvailable={false}
        googleAvailable={false}
        isProduction={false}
        registrationMode='open'
      />
    )
  }

  it.each(['es', 'zh'] as const)(
    'pushes the canonical verify path after signup for %s',
    async (locale) => {
      mockSignUpEmail.mockResolvedValue({ user: { id: 'user-1' } })
      mockRefetchSession.mockResolvedValue(undefined)
      mockSendVerificationOtp.mockResolvedValue(undefined)

      await renderWithLocale(
        locale,
        <SignupPage
          githubAvailable={false}
          googleAvailable={false}
          isProduction={false}
          registrationMode='open'
        />
      )

      await setInputValue('#name', 'Ada Lovelace')
      await setInputValue('#email', 'ada@example.com')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()

      expect(mockRefetchSession).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/verify?fromSignup=true')
    }
  )

  it.each(['es', 'zh'] as const)(
    'pushes the canonical verify path after an unverified login for %s',
    async (locale) => {
      mockSignInEmail.mockRejectedValue({ code: 'EMAIL_NOT_VERIFIED' })

      await renderLogin(locale)

      await setInputValue('#email', 'ada@example.com')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()

      expect(mockPush).toHaveBeenCalledWith('/verify')
    }
  )

  it('aborts a hanging reauth cleanup before direct login starts', async () => {
    vi.useFakeTimers()
    testState.searchParams = new URLSearchParams('reauth=1&callbackUrl=%2Fworkspace')
    const cleanupSignalRef: { current: AbortSignal | null } = { current: null }
    mockSignOut.mockImplementation((options) => {
      cleanupSignalRef.current = options?.fetchOptions?.signal ?? null
      return new Promise(() => {})
    })
    mockSignInEmail.mockResolvedValue({})

    await renderLogin()

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(container.querySelector('form')).toBeInstanceOf(HTMLFormElement)

    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')

    await submitRenderedForm()

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignInEmail).not.toHaveBeenCalled()

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
    })

    expect(cleanupSignalRef.current?.aborted).toBe(true)
    expect(mockSignInEmail).toHaveBeenCalledTimes(1)
  })

  it('runs reauth cleanup when direct login cannot create a session', async () => {
    mockSignInEmail.mockResolvedValue({ error: { code: 'FAILED_TO_CREATE_SESSION' } })
    mockSignOut.mockReturnValue(new Promise(() => {}))

    await renderLogin()

    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()

    expect(mockSignInEmail).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(getPublicCopy('en').auth.login.errors.unableToSignInNow)
  })

  it('keeps invalid credential failures on the login form', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { code: 'INVALID_CREDENTIALS', status: 401 },
    })

    await renderLogin()

    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'wrong-password')
    await submitRenderedForm()

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(container.querySelector('form')).toBeInstanceOf(HTMLFormElement)
    expect(container.textContent).toContain(
      getPublicCopy('en').auth.login.errors.invalidCredentials
    )
  })

  it('pushes the canonical signup path from the verify screen back action', async () => {
    mockUseVerification.mockReturnValue({
      otp: '',
      email: 'ada@example.com',
      isLoading: false,
      isVerified: false,
      isInvalidOtp: false,
      errorMessage: '',
      isOtpComplete: false,
      hasEmailService: true,
      isProduction: false,
      isEmailVerificationEnabled: true,
      verifyCode: vi.fn(),
      resendCode: vi.fn(),
      handleOtpChange: vi.fn(),
    })

    await renderWithLocale(
      'en',
      <VerifyContent hasEmailService isProduction={false} isEmailVerificationEnabled />
    )

    const backButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === getPublicCopy('en').auth.common.backToSignup
    )

    if (!(backButton instanceof HTMLButtonElement)) {
      throw new Error('Expected back to signup button to render')
    }

    await act(async () => {
      backButton.click()
    })

    expect(mockPush).toHaveBeenCalledWith('/signup')
  })
})
