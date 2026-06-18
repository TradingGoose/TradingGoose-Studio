/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_ERROR_CALLBACK_COOKIE } from '@/lib/auth/auth-error-copy'
import { getPublicCopy } from '@/i18n/public-copy'
import { SocialLoginButtons } from './components/social-login-buttons'
import SSOForm from './sso/sso-form'

const mockSocialSignIn = vi.hoisted(() => vi.fn())
const mockSsoSignIn = vi.hoisted(() => vi.fn())
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
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signIn: {
      social: mockSocialSignIn,
      sso: mockSsoSignIn,
    },
  },
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

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/icons/icons', () => ({
  GithubIcon: () => <span />,
  GoogleIcon: () => <span />,
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

describe('auth provider callback routing', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    testState.searchParams = new URLSearchParams()
    mockSocialSignIn.mockResolvedValue({})
    mockSsoSignIn.mockResolvedValue({})
    document.cookie = `${AUTH_ERROR_CALLBACK_COOKIE}=; path=/; max-age=0`
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it.each([
    ['Google', 'google'],
    ['GitHub', 'github'],
  ])('routes %s OAuth callback failures to the auth error page', async (buttonText, provider) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <SocialLoginButtons
            githubAvailable
            googleAvailable
            callbackURL='/workspace'
            isProduction
          />
        </NextIntlClientProvider>
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(buttonText)
    )
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Expected ${buttonText} button to render`)
    }

    await act(async () => {
      button.click()
    })

    expect(mockSocialSignIn).toHaveBeenCalledWith({
      provider,
      callbackURL: '/workspace',
      errorCallbackURL: '/error',
    })
    expect(document.cookie).toContain(`${AUTH_ERROR_CALLBACK_COOKIE}=%2Fworkspace`)
  })

  it('routes SSO callback failures to the auth error page', async () => {
    testState.searchParams = new URLSearchParams({ callbackUrl: '/workspace' })

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <SSOForm registrationMode='open' />
        </NextIntlClientProvider>
      )
    })

    const input = container.querySelector('input[name="email"]')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected SSO email input to render')
    }

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, 'user@example.com')

    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Expected SSO form to render')
    }

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(mockSsoSignIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      callbackURL: '/workspace',
      errorCallbackURL: '/error',
    })
    expect(document.cookie).toContain(`${AUTH_ERROR_CALLBACK_COOKIE}=%2Fworkspace`)
  })
})
