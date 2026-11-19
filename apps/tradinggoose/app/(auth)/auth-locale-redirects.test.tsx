/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPasswordPage from '@/app/[locale]/(auth)/reset-password/page'
import { getPublicCopy } from '@/i18n/public-copy'
import LoginPage from './login/login-form'
import SignupPage from './signup/signup-form'
import { VerifyContent } from './verify/verify-content'

const mockRouter = vi.hoisted(() => ({ push: vi.fn() }))
const mockPush = mockRouter.push
const mockSignUpEmail = vi.hoisted(() => vi.fn())
const mockIsUsernameAvailable = vi.hoisted(() => vi.fn())
const mockSignInEmail = vi.hoisted(() => vi.fn())
const mockSignInUsername = vi.hoisted(() => vi.fn())
const mockSignOut = vi.hoisted(() => vi.fn())
const mockRequestPasswordReset = vi.hoisted(() => vi.fn())
const mockResetPassword = vi.hoisted(() => vi.fn())
const mockRequestPasswordResetOtp = vi.hoisted(() => vi.fn())
const mockResetPasswordOtp = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())
const testState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => testState.searchParams,
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
  useRouter: () => mockRouter,
  usePathname: () => '/login',
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    isUsernameAvailable: mockIsUsernameAvailable,
    signUp: {
      email: mockSignUpEmail,
    },
    signIn: {
      email: mockSignInEmail,
      username: mockSignInUsername,
    },
    signOut: mockSignOut,
    requestPasswordReset: mockRequestPasswordReset,
    resetPassword: mockResetPassword,
    emailOtp: {
      requestPasswordReset: mockRequestPasswordResetOtp,
      resetPassword: mockResetPasswordOtp,
    },
  },
}))

vi.mock('@/app/(auth)/components/auth-page-header', () => ({
  AuthPageHeader: ({ description }: { description: string }) => <p>{description}</p>,
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
  InputOTP: ({
    children,
    id,
    value,
    onChange,
  }: {
    children?: React.ReactNode
    id?: string
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      {children}
    </div>
  ),
  InputOTPGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  InputOTPSlot: ({ index }: { index: number }) => <div data-index={index} />,
}))

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    EMAIL_VERIFICATION_ENABLED: false,
  },
  getEnv: vi.fn((key: string) =>
    key === 'NEXT_PUBLIC_APP_URL' ? 'https://example.com' : undefined
  ),
  isTruthy: vi.fn(() => false),
}))

describe('auth locale redirects', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
    })
    testState.searchParams = new URLSearchParams()
    const stored = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
      removeItem: (key: string) => stored.delete(key),
    })
    mockPush.mockReset()
    mockSignUpEmail.mockReset()
    mockIsUsernameAvailable
      .mockReset()
      .mockResolvedValue({ data: { available: true }, error: null })
    mockSignInEmail.mockReset()
    mockSignInUsername.mockReset()
    mockSignOut.mockReset()
    mockRequestPasswordResetOtp
      .mockReset()
      .mockResolvedValue({ data: { success: true }, error: null })
    mockResetPasswordOtp.mockReset().mockResolvedValue({ data: { status: true }, error: null })
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    mockRequestPasswordReset.mockReset()
    mockRequestPasswordReset.mockResolvedValue({ error: null })
    mockResetPassword.mockReset()
    mockResetPassword.mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function renderWithLocale(locale: 'en' | 'es' | 'zh', element: React.ReactElement) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
            {element}
          </NextIntlClientProvider>
        </QueryClientProvider>
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
      <LoginPage githubAvailable={false} googleAvailable={false} registrationMode='open' />
    )
  }

  it.each([
    ['es', null, null],
    ['zh', '/chat/deployed-chat?view=thread#reply', null],
    ['es', '/invite/invitation?token=workspace-token', null],
    ['es', '/invite/invitation?token=workspace-token', 'session-token'],
  ] as const)(
    'preserves the signup destination for %s with callback %s and session token %s',
    async (locale, callbackUrl, token) => {
      if (callbackUrl) testState.searchParams = new URLSearchParams({ callbackUrl })
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'user-1' }, token }, error: null })
      mockRequestPasswordResetOtp.mockResolvedValue(undefined)

      await renderWithLocale(
        locale,
        <SignupPage githubAvailable={false} googleAvailable={false} registrationMode='open' />
      )
      const loginLink = new URL(
        container.querySelector('a[href^="/login"]')!.getAttribute('href')!,
        window.location.origin
      )
      expect(loginLink.searchParams.get('callbackUrl')).toBe(callbackUrl ?? '/workspace')
      expect(loginLink.searchParams.get('invite_flow')).toBe(
        callbackUrl?.startsWith('/invite/') ? 'true' : null
      )

      await setInputValue('#name', 'Ada Lovelace')
      await setInputValue('#username', 'Ada.Lovelace')
      await setInputValue('#email', 'ada@example.com')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()

      expect(mockSignUpEmail).toHaveBeenCalledWith(
        {
          name: 'Ada Lovelace',
          username: 'Ada.Lovelace',
          email: 'ada@example.com',
          password: 'Password1!',
        },
        expect.any(Object)
      )

      expect(mockFetch).not.toHaveBeenCalled()
      const verifyPath = `/verify?fromSignup=true&redirectAfter=${encodeURIComponent(callbackUrl ?? '/workspace')}${callbackUrl?.startsWith('/invite/') ? '&invite_flow=true' : ''}`
      expect(mockPush).toHaveBeenCalledExactlyOnceWith(verifyPath)
      if (token) {
        expect(mockRequestPasswordResetOtp).not.toHaveBeenCalled()
        expect(sessionStorage.setItem).not.toHaveBeenCalled()
        testState.searchParams = new URL(verifyPath, window.location.origin).searchParams
        await renderWithLocale(
          locale,
          <VerifyContent hasEmailService isEmailVerificationEnabled={false} />
        )

        expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
          '/api/users/me/settings',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ preferredLocale: locale }),
          })
        )
        expect(mockFetch.mock.invocationCallOrder[0]).toBeLessThan(
          mockPush.mock.invocationCallOrder[1]
        )
        expect(mockPush).toHaveBeenLastCalledWith(callbackUrl)
        expect(mockResetPasswordOtp).not.toHaveBeenCalled()
        expect(mockRequestPasswordResetOtp).not.toHaveBeenCalled()
        return
      }
      expect(mockRequestPasswordResetOtp).toHaveBeenCalledWith({
        email: 'ada@example.com',
      })
      expect(sessionStorage.setItem).toHaveBeenCalledExactlyOnceWith(
        'verificationEmail',
        'ada@example.com'
      )
    }
  )

  it('requires an entered username independently of the full name', async () => {
    await renderWithLocale(
      'en',
      <SignupPage githubAvailable={false} googleAvailable={false} registrationMode='open' />
    )
    await setInputValue('#name', 'Ada Lovelace')
    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()
    expect(mockSignUpEmail).not.toHaveBeenCalled()
    expect(container.querySelector('#signup-username-error')?.textContent).toBe(
      getPublicCopy('en').username.required
    )
  })

  describe('signup username availability', () => {
    beforeEach(() => vi.useFakeTimers())

    async function renderSignup(locale: 'en' | 'es' | 'zh' = 'en') {
      await renderWithLocale(
        locale,
        <SignupPage githubAvailable={false} googleAvailable={false} registrationMode='open' />
      )
      await setInputValue('#name', 'Ada Lovelace')
      await setInputValue('#email', 'ada@example.com')
      await setInputValue('#password', 'Password1!')
    }

    async function checkAvailability() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }

    it('checks only the current browser-valid candidate and clears feedback when it is emptied', async () => {
      const copy = getPublicCopy('es').username
      await renderSignup('es')
      await setInputValue('#username', 'invalid username')
      await checkAvailability()
      expect(mockIsUsernameAvailable).not.toHaveBeenCalled()
      await setInputValue('#username', 'Ada.Name')
      expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.checking)
      expect(container.querySelector('#username')).toHaveAttribute(
        'aria-describedby',
        'signup-username-hint signup-username-status'
      )
      await checkAvailability()
      expect(mockIsUsernameAvailable).toHaveBeenCalledWith(
        { username: 'ada.name' },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.available)
      await setInputValue('#username', '')
      expect(container.querySelector('[role="status"]')).toBeNull()
    })

    it('blocks a known-taken candidate but still honors a native signup conflict after an available result', async () => {
      mockIsUsernameAvailable.mockResolvedValueOnce({ data: { available: false }, error: null })
      await renderSignup()
      await setInputValue('#username', 'Taken.Name')
      await checkAvailability()
      const taken = getPublicCopy('en').username.taken
      expect(container.querySelector('#signup-username-error')?.textContent).toBe(taken)
      await submitRenderedForm()
      expect(mockSignUpEmail).not.toHaveBeenCalled()
      await setInputValue('#username', 'Free.Name')
      expect(container.querySelector('#signup-username-error')).toBeNull()
      expect(container.querySelector('button[type="submit"]')).toBeEnabled()
      await checkAvailability()
      mockSignUpEmail.mockImplementation(async (_body, options) => {
        const error = { code: 'USERNAME_IS_ALREADY_TAKEN' }
        options.onError({ error })
        return { error }
      })
      await submitRenderedForm()
      expect(mockSignUpEmail).toHaveBeenCalledOnce()
      expect(container.querySelector('#signup-username-error')?.textContent).toBe(taken)
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('shows a localized check failure while allowing authoritative signup', async () => {
      mockIsUsernameAvailable.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } })
      mockSignUpEmail.mockResolvedValue({ user: { id: 'user-1' } })
      await renderSignup('zh')
      await setInputValue('#username', 'Ada.Name')
      await checkAvailability()
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        getPublicCopy('zh').username.error
      )
      expect(container.querySelector('button[type="submit"]')).toBeEnabled()
      await submitRenderedForm()
      expect(mockSignUpEmail).toHaveBeenCalledOnce()
      expect(mockPush).toHaveBeenCalledWith('/verify?fromSignup=true&redirectAfter=%2Fworkspace')
    })
  })

  it.each([
    ['USERNAME_TOO_SHORT', 'length'],
    ['USERNAME_TOO_LONG', 'length'],
    ['INVALID_USERNAME', 'invalid'],
    ['USERNAME_IS_ALREADY_TAKEN', 'taken'],
  ] as const)('localizes native signup username error %s', async (code, key) => {
    mockSignUpEmail.mockImplementation(async (_body, options) => {
      const error = { code }
      options.onError({ error })
      return { error }
    })
    await renderWithLocale(
      'es',
      <SignupPage githubAvailable={false} googleAvailable={false} registrationMode='open' />
    )
    await setInputValue('#name', 'Ada Lovelace')
    await setInputValue('#username', 'Ada.Lovelace')
    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()
    expect(container.querySelector('#signup-username-error')?.textContent).toBe(
      getPublicCopy('es').username[key]
    )
    expect(mockRequestPasswordResetOtp).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it.each([
    { identifier: 'ADA@EXAMPLE.COM', method: 'email', normalized: 'ada@example.com' },
    { identifier: 'Ada.Lovelace', method: 'username', normalized: 'Ada.Lovelace' },
  ] as const)(
    'uses native $method login without an identity lookup',
    async ({ identifier, method, normalized }) => {
      const signIn = method === 'email' ? mockSignInEmail : mockSignInUsername
      signIn.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
      await renderLogin()
      await setInputValue('#email', identifier)
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()
      expect(signIn).toHaveBeenCalledWith({
        [method]: normalized,
        password: 'Password1!',
        callbackURL: '/workspace',
      })
      expect(method === 'email' ? mockSignInUsername : mockSignInEmail).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('keeps the signup code usable for a valid password and returns to login if sign-in fails', async () => {
    const destination = '/invite/invitation?token=invitation'
    testState.searchParams = new URLSearchParams({
      fromSignup: 'true',
      redirectAfter: destination,
      invite_flow: 'true',
    })
    sessionStorage.setItem('verificationEmail', 'ada@example.com')
    mockSignInEmail.mockResolvedValue({ error: { code: 'RATE_LIMIT' } })

    await renderWithLocale('en', <VerifyContent hasEmailService isEmailVerificationEnabled />)
    await setInputValue('#verification-code', '123456')
    await setInputValue('#password', 'onlylowercase')
    await submitRenderedForm()
    expect(mockResetPasswordOtp).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      getPublicCopy('en').auth.signup.validation.passwordUppercase
    )
    await setInputValue('#password', 'StrongPassword1!')
    await submitRenderedForm()
    expect(mockResetPasswordOtp).toHaveBeenCalledExactlyOnceWith({
      email: 'ada@example.com',
      otp: '123456',
      password: 'StrongPassword1!',
    })
    expect(mockPush).toHaveBeenCalledExactlyOnceWith(
      `/login?callbackUrl=${encodeURIComponent(destination)}&invite_flow=true`
    )
    expect(sessionStorage.getItem('verificationEmail')).toBeNull()
  })

  it.each(['returned', 'thrown'] as const)(
    'keeps a username-only unverified %s failure on login without sending a username to email verification',
    async (kind) => {
      const error = { code: 'EMAIL_NOT_VERIFIED' }
      if (kind === 'thrown') mockSignInUsername.mockRejectedValue(error)
      else mockSignInUsername.mockResolvedValue({ error })
      await renderLogin('zh')
      await setInputValue('#email', 'Ada.Lovelace')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()
      expect(container.textContent).toContain(getPublicCopy('zh').auth.login.errors.verifyWithEmail)
      expect(sessionStorage.setItem).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
      expect(mockRequestPasswordResetOtp).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['waitlist', false, '/waitlist'],
    ['disabled', false, null],
    ['waitlist', true, '/signup'],
    ['disabled', true, '/signup'],
  ] as const)(
    'preserves %s registration policy with invitation context %s',
    async (registrationMode, isInviteFlow, path) => {
      const callbackUrl = '/invite/invitation?token=workspace-token'
      testState.searchParams = new URLSearchParams({
        callbackUrl,
        ...(isInviteFlow ? { invite_flow: 'true' } : {}),
      })
      await renderWithLocale(
        'en',
        <LoginPage
          githubAvailable={false}
          googleAvailable={false}
          registrationMode={registrationMode}
        />
      )
      const href = container
        .querySelector('a[href^="/signup"], a[href^="/waitlist"]')
        ?.getAttribute('href')
      if (path === null) {
        expect(href).toBeUndefined()
      } else {
        const url = new URL(href!, window.location.origin)
        expect(url.pathname).toBe(path)
        expect(url.searchParams.get('callbackUrl')).toBe(path === '/signup' ? callbackUrl : null)
        expect(url.searchParams.get('invite_flow')).toBe(isInviteFlow ? 'true' : null)
      }
    }
  )

  it.each([
    [null, '/workspace'],
    ['/invite/organization-invitation', '/invite/organization-invitation'],
    [
      '/invite/workspace-invitation?token=workspace-token',
      '/invite/workspace-invitation?token=workspace-token',
    ],
    [
      `${window.location.origin}/invite/workspace-invitation?token=workspace-token`,
      '/invite/workspace-invitation?token=workspace-token',
    ],
    ['https://external.example/invite/invitation', '/workspace'],
    ['/chat/deployed-chat?view=thread#reply', '/chat/deployed-chat?view=thread#reply'],
    ['/zh/invite/invitation?token=workspace-token', '/workspace'],
  ])(
    'completes email verification after callback-only login with destination %s',
    async (callbackUrl, redirectUrl) => {
      vi.useFakeTimers()
      sessionStorage.setItem('verificationEmail', 'previous@example.com')
      vi.mocked(sessionStorage.setItem).mockClear()
      if (callbackUrl) {
        testState.searchParams = new URLSearchParams({ callbackUrl })
      }
      let finish!: (value: { error: null }) => void
      mockRequestPasswordResetOtp.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      mockSignInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED' } })
      await renderLogin()
      const signupLink = new URL(
        container.querySelector('a[href^="/signup"]')!.getAttribute('href')!,
        window.location.origin
      )
      expect(signupLink.searchParams.get('callbackUrl')).toBe(redirectUrl)
      expect(signupLink.searchParams.has('invite_flow')).toBe(false)
      await setInputValue('#email', 'ADA@EXAMPLE.COM')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()
      expect(mockRequestPasswordResetOtp).toHaveBeenCalledExactlyOnceWith({
        email: 'ada@example.com',
      })
      expect(mockPush).not.toHaveBeenCalled()
      expect(sessionStorage.setItem).not.toHaveBeenCalled()
      await act(async () => finish({ error: null }))
      expect(mockRequestPasswordResetOtp.mock.invocationCallOrder[0]).toBeLessThan(
        mockPush.mock.invocationCallOrder[0]
      )
      expect(sessionStorage.setItem).toHaveBeenCalledExactlyOnceWith(
        'verificationEmail',
        'ada@example.com'
      )
      const verifyPath = `/verify?redirectAfter=${encodeURIComponent(redirectUrl!)}`
      expect(mockPush).toHaveBeenCalledExactlyOnceWith(verifyPath)
      testState.searchParams = new URL(
        mockPush.mock.lastCall![0],
        window.location.origin
      ).searchParams
      await renderWithLocale('zh', <VerifyContent hasEmailService isEmailVerificationEnabled />)
      mockSignInEmail.mockResolvedValueOnce({ error: null })
      await setInputValue('#verification-code', '123456')
      await setInputValue('#password', 'ChosenPassword1!')
      await submitRenderedForm()
      await act(async () => vi.advanceTimersByTimeAsync(1000))
      expect(mockResetPasswordOtp).toHaveBeenCalledExactlyOnceWith({
        email: 'ada@example.com',
        otp: '123456',
        password: 'ChosenPassword1!',
      })
      expect(mockSignInEmail).toHaveBeenLastCalledWith({
        email: 'ada@example.com',
        password: 'ChosenPassword1!',
      })
      expect(mockPush).toHaveBeenLastCalledWith(redirectUrl)
      expect(sessionStorage.getItem('verificationEmail')).toBeNull()
    }
  )

  it.each(['returned', 'thrown'] as const)(
    'keeps an unverified email login on the form when sending the code fails: %s',
    async (failure) => {
      testState.searchParams = new URLSearchParams({
        callbackUrl: '/invite/invitation?token=workspace-token',
        invite_flow: 'true',
      })
      mockSignInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED' } })
      if (failure === 'returned')
        mockRequestPasswordResetOtp.mockResolvedValue({ error: { code: 'SEND_FAILED' } })
      else mockRequestPasswordResetOtp.mockRejectedValue(new Error('Network failure'))
      await renderLogin('es')
      await setInputValue('#email', 'ADA@EXAMPLE.COM')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()
      expect(mockRequestPasswordResetOtp).toHaveBeenCalledExactlyOnceWith({
        email: 'ada@example.com',
      })
      expect(mockPush).not.toHaveBeenCalled()
      expect(sessionStorage.setItem).not.toHaveBeenCalled()
      expect(container.textContent).toContain(getPublicCopy('es').auth.verify.errors.resendFailed)
      expect(container.querySelector('button[type="submit"]')).toBeEnabled()
    }
  )

  it.each([
    ['INVALID_USERNAME_OR_PASSWORD', 'invalidCredentials'],
    ['INVALID_USERNAME', 'invalid'],
    ['USERNAME_TOO_SHORT', 'length'],
    ['USERNAME_TOO_LONG', 'length'],
  ] as const)('localizes native username login error %s', async (code, key) => {
    mockSignInUsername.mockResolvedValue({ error: { code } })
    await renderLogin('zh')
    await setInputValue('#email', 'Ada.Lovelace')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()
    const copy = getPublicCopy('zh')
    expect(container.textContent).toContain(
      key === 'invalidCredentials' ? copy.auth.login.errors.invalidCredentials : copy.username[key]
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('keeps password recovery addressed to email when the login identifier is a username', async () => {
    await renderLogin()
    await setInputValue('#email', 'Ada.Lovelace')
    await setInputValue('#reset-email', 'ada@example.com')
    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === getPublicCopy('en').auth.login.resetDialog.submit
    )!
    await act(async () => submit.click())
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({
      email: 'ada@example.com',
      redirectTo: expect.stringContaining('/reset-password'),
    })
    expect(mockSignInUsername).not.toHaveBeenCalled()
  })

  it.each([
    [null, null],
    [
      '/invite/invitation?token=workspace-token#accept',
      '/invite/invitation?token=workspace-token#accept',
    ],
    ['https://external.example/redirect', null],
  ])(
    'redeems the native reset token and keeps the safe callback from %s',
    async (callback, destination) => {
      vi.useFakeTimers()
      testState.searchParams = new URLSearchParams('token=reset-token')
      if (callback) testState.searchParams.set('callbackUrl', callback)
      if (destination) testState.searchParams.set('invite_flow', 'true')
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
            <ResetPasswordPage />
          </NextIntlClientProvider>
        )
      })
      await setInputValue('#password', 'Password1!')
      await setInputValue('#confirmPassword', 'Password1!')
      await submitRenderedForm()

      expect(mockResetPassword).toHaveBeenCalledWith({
        token: 'reset-token',
        newPassword: 'Password1!',
      })
      expect(container.textContent).toContain(getPublicCopy('en').auth.resetPassword.success)
      await act(async () => vi.advanceTimersByTimeAsync(1500))
      const login = new URL(mockPush.mock.lastCall![0], window.location.origin)
      expect(login.pathname).toBe('/login')
      expect(login.searchParams.get('resetSuccess')).toBe('true')
      expect(login.searchParams.get('callbackUrl')).toBe(destination)
      expect(login.searchParams.get('invite_flow')).toBe(destination ? 'true' : null)
    }
  )

  it.each(['es', 'zh'] as const)(
    'pushes the canonical verify path after an unverified login for %s',
    async (locale) => {
      const callbackUrl = '/invite/invitation?token=workspace-token'
      testState.searchParams = new URLSearchParams({ callbackUrl, invite_flow: 'true' })
      mockSignInEmail.mockRejectedValue({ code: 'EMAIL_NOT_VERIFIED' })

      await renderLogin(locale)

      await setInputValue('#email', 'ada@example.com')
      await setInputValue('#password', 'Password1!')
      await submitRenderedForm()

      expect(sessionStorage.setItem).toHaveBeenCalledExactlyOnceWith(
        'verificationEmail',
        'ada@example.com'
      )
      expect(mockPush).toHaveBeenCalledWith(
        `/verify?redirectAfter=${encodeURIComponent(callbackUrl)}&invite_flow=true`
      )
    }
  )

  it('runs reauth cleanup on arrival and waits before direct login starts', async () => {
    vi.useFakeTimers()
    testState.searchParams = new URLSearchParams('reauth=1&callbackUrl=%2Fworkspace')
    const cleanupSignalRef: { current: AbortSignal | null } = { current: null }
    mockSignOut.mockImplementation((options) => {
      cleanupSignalRef.current = options?.fetchOptions?.signal ?? null
      return new Promise(() => {})
    })
    mockSignInEmail.mockResolvedValue({})

    await renderLogin()

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(container.querySelector('form')).toBeInstanceOf(HTMLFormElement)

    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')

    await submitRenderedForm()

    expect(mockSignInEmail).not.toHaveBeenCalled()

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await Promise.resolve()
    })

    expect(cleanupSignalRef.current?.aborted).toBe(true)
    expect(mockSignInEmail).toHaveBeenCalledTimes(1)
  })

  it.each([
    'FAILED_TO_CREATE_SESSION',
    'UNABLE_TO_CREATE_SESSION',
    'FAILED_TO_GET_SESSION',
    'SESSION_EXPIRED',
  ])('runs reauth cleanup when direct login returns %s', async (errorCode) => {
    mockSignInEmail.mockResolvedValue({ error: { code: errorCode } })
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
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 },
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

  it.each([
    [
      { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
      'invalidCredentials',
    ],
    [{ code: 'EMAIL_PASSWORD_DISABLED' }, 'emailPasswordDisabled'],
    [{ status: 429, message: 'Too many requests. Please try again later.' }, 'rateLimit'],
    [{ code: 'UNEXPECTED_ERROR' }, 'unableToSignInNow'],
  ] as const)('localizes native email login failure %j', async (error, key) => {
    mockSignInEmail.mockResolvedValue({ error })
    await renderLogin('zh')
    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()

    expect(container.textContent).toContain(getPublicCopy('zh').auth.login.errors[key])
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('localizes a thrown fetch failure', async () => {
    mockSignInEmail.mockRejectedValue(new TypeError('Failed to fetch'))
    await renderLogin('zh')
    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()

    expect(container.textContent).toContain(getPublicCopy('zh').auth.login.errors.network)
  })

  it('preserves the server access restriction message', async () => {
    const message = 'Access restricted. Please contact your administrator.'
    mockSignInEmail.mockResolvedValue({ error: { status: 403, message } })
    await renderLogin()
    await setInputValue('#email', 'ada@example.com')
    await setInputValue('#password', 'Password1!')
    await submitRenderedForm()

    expect(container.textContent).toContain(message)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it.each([
    ['signup', '/invite/invitation?token=workspace-token#accept', '&invite_flow=true'],
    ['login', '/chat/deployed-chat?view=thread#reply', ''],
  ] as const)(
    'keeps the resend cooldown and returns to %s with the destination',
    async (path, destination, invite) => {
      vi.useFakeTimers()
      sessionStorage.setItem('verificationEmail', 'ada@example.com')
      testState.searchParams = new URLSearchParams(
        `fromSignup=${path === 'signup'}&redirectAfter=${encodeURIComponent(destination)}${invite}`
      )

      await renderWithLocale('en', <VerifyContent hasEmailService isEmailVerificationEnabled />)
      const findButton = (label: string) =>
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === label
        )
      const resendLabel = getPublicCopy('en').auth.verify.resendButton
      const resendButton = findButton(resendLabel)
      if (!(resendButton instanceof HTMLButtonElement)) {
        throw new Error('Expected resend button to render')
      }
      await act(async () => resendButton.click())
      expect(mockRequestPasswordResetOtp).toHaveBeenCalledOnce()
      expect(findButton(resendLabel)).toBeUndefined()
      for (let second = 0; second < 29; second++) {
        await act(async () => vi.advanceTimersByTimeAsync(1000))
      }
      expect(findButton(resendLabel)).toBeUndefined()
      await act(async () => vi.advanceTimersByTimeAsync(1000))
      expect(findButton(resendLabel)?.disabled).toBe(false)

      const common = getPublicCopy('en').auth.common
      const backButton = findButton(path === 'signup' ? common.backToSignup : common.backToLogin)

      if (!(backButton instanceof HTMLButtonElement)) {
        throw new Error(`Expected back to ${path} button to render`)
      }

      await act(async () => {
        backButton.click()
      })

      expect(mockPush).toHaveBeenCalledExactlyOnceWith(
        `/${path}?callbackUrl=${encodeURIComponent(destination)}${invite}`
      )
      expect(sessionStorage.getItem('verificationEmail')).toBeNull()
    }
  )
})
