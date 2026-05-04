/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import LoginPage from './login-form'

const { useLocaleMock, useSearchParamsMock, useRouterPushMock, getEnvMock, isTruthyMock } =
  vi.hoisted(() => ({
    useLocaleMock: vi.fn(() => 'zh-CN'),
    useSearchParamsMock: vi.fn(() => new URLSearchParams('')),
    useRouterPushMock: vi.fn(),
    getEnvMock: vi.fn(),
    isTruthyMock: vi.fn(() => false),
  }))

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
      sso: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    emailOtp: {
      sendVerificationOtp: vi.fn(),
    },
  },
}))

const localizeHref = (href: string, locale: string) => {
  if (!href.startsWith('/')) return href
  const localePrefix = locale === 'zh-CN' ? '/zh' : `/${locale}`
  if (href.startsWith(localePrefix)) return href
  return locale === 'en' ? href : `${localePrefix}${href}`
}

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; href: string }) => {
    const locale = useLocaleMock()

    return (
      <a href={localizeHref(href, locale)} {...props}>
        {children}
      </a>
    )
  },
  useRouter: () => ({
    push: useRouterPushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    EMAIL_VERIFICATION_ENABLED: false,
  },
  getEnv: getEnvMock,
  isTruthy: isTruthyMock,
}))

vi.mock('@/lib/auth-client', () => ({
  client: mockClient,
}))

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: '' },
}))

vi.mock('@/app/fonts/soehne/soehne', () => ({
  soehne: { className: '' },
}))

describe('login screen localization', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    useLocaleMock.mockReturnValue('zh-CN')
    useSearchParamsMock.mockReturnValue(new URLSearchParams(''))
    getEnvMock.mockReturnValue(undefined)
    isTruthyMock.mockReturnValue(false)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders translated login CTA text and locale-prefixed signup href', async () => {
    const copy = getPublicCopy('zh-CN')

    await act(async () => {
      root.render(
        <LoginPage
          githubAvailable={false}
          googleAvailable={false}
          isProduction={false}
          registrationMode='open'
        />
      )
    })

    expect(container.querySelector('h1')?.textContent).toBe(copy.auth.login.title)
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
      copy.auth.login.submit
    )

    const signupLink = container.querySelector('a[href="/zh/signup"]')
    expect(signupLink?.textContent).toBe(copy.registration.open.auth)
    expect(signupLink?.getAttribute('href')).toBe('/zh/signup')
  })
})
