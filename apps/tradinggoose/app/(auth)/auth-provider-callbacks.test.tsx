/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthErrorCallbackPath } from '@/lib/auth/auth-error-copy'
import { Integrations } from '@/app/workspace/[workspaceId]/integrations/integrations'
import { getPublicCopy } from '@/i18n/public-copy'
import { SocialLoginButtons } from './components/social-login-buttons'
import SSOForm from './sso/sso-form'

const mockSocialSignIn = vi.hoisted(() => vi.fn())
const mockSsoSignIn = vi.hoisted(() => vi.fn())
const integrationTranslate = vi.hoisted(() => {
  const copy: Record<string, string> = {
    successMessage: 'Account connected successfully!',
    connect: 'Connect',
    connecting: 'Connecting...',
    disconnect: 'Disconnect',
    'emptyState.noConnectible': 'No connectible integrations are configured.',
    'failures.load': 'Failed to load integrations. Please try again.',
    'failures.disconnectInUse':
      'Delete or reconfigure dependent webhooks before disconnecting this account.',
  }
  return (key: string) => copy[key] ?? key
})
const integrationRouter = vi.hoisted(() => ({ replace: vi.fn() }))
const integrationMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  refetch: vi.fn(),
  services: [
    {
      id: 'drive',
      providerId: 'google-drive',
      name: 'Drive',
      description: 'Cloud files',
      scopes: [],
      isConnected: false,
      accounts: [] as { id: string; name: string }[],
      icon: () => null,
    },
  ],
}))
const testState = vi.hoisted(() => {
  const state = {} as {
    searchParams: URLSearchParams
    adapter: { get: (key: string) => string | null }
  }
  state.searchParams = new URLSearchParams()
  state.adapter = { get: (key) => state.searchParams.get(key) }
  return state
})

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: () => integrationTranslate,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useSearchParams: () => testState.adapter,
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
  usePathname: () => '/workspace/workspace-1/integrations',
  useRouter: () => integrationRouter,
}))

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({ left }: { left?: React.ReactNode }) => <header>{left}</header>,
}))

vi.mock('@/lib/oauth/oauth', () => ({
  OAUTH_PROVIDERS: {
    google: {
      name: 'Google',
      services: {
        drive: {
          id: 'drive',
          providerId: 'google-drive',
          name: 'Drive',
          description: 'Cloud files',
          scopes: [],
        },
      },
    },
  },
}))

vi.mock('@/lib/oauth/connect', () => ({
  startOAuthConnectFlow: (...args: unknown[]) => integrationMocks.connect(...args),
}))

vi.mock('@/hooks/queries/oauth-connections', () => ({
  oauthConnectionsKeys: { connections: () => ['oauthConnections', 'connections'] },
  disconnectOAuthService: (...args: unknown[]) => integrationMocks.disconnect(...args),
  useOAuthConnections: () => ({
    data: integrationMocks.services,
    isError: false,
    isPending: false,
    refetch: integrationMocks.refetch,
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signIn: {
      social: mockSocialSignIn,
      sso: mockSsoSignIn,
    },
  },
}))

vi.mock('@/components/ui/button', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/button')>()),
  Button: ({
    children,
    focusableWhenDisabled: _focusableWhenDisabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode
    focusableWhenDisabled?: boolean
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
  Alert: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
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
      errorCallbackURL: getAuthErrorCallbackPath('/workspace'),
    })
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
      errorCallbackURL: getAuthErrorCallbackPath('/workspace'),
    })
  })
})

const integrationCopy = getPublicCopy('en').workspace.integrations
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('integration provider feedback', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    testState.searchParams = new URLSearchParams()
    integrationMocks.services[0].accounts = []
    integrationMocks.refetch.mockResolvedValue(undefined)
    integrationMocks.connect.mockResolvedValue(undefined)
    integrationMocks.disconnect.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ 'google-drive': true })))
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderPage = async (search: Record<string, string> = {}) => {
    testState.searchParams = new URLSearchParams(search)
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Integrations />
        </QueryClientProvider>
      )
      await flush()
    })
  }
  const action = (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing action: ${label}`)
    return button
  }
  const click = (label: string) =>
    act(async () => {
      action(label).click()
      await flush()
    })

  it.each([
    [
      { code: 'authorization-code', state: 'oauth-state' },
      'status',
      integrationCopy.successMessage,
    ],
    [
      { error: 'access_denied', error_description: 'The provider rejected access' },
      'alert',
      'The provider rejected access',
    ],
  ])('announces OAuth callback feedback', async (search, role, message) => {
    await renderPage(search)
    const feedback = container.querySelectorAll(`[role="${role}"]`)
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toHaveTextContent(message)
  })

  it('distinguishes load and mutation failures in one alert channel', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }))
    await renderPage()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      integrationCopy.failures.load
    )
    expect(container.textContent).not.toContain(integrationCopy.emptyState.noConnectible)

    act(() => root.unmount())
    root = createRoot(container)
    vi.mocked(fetch).mockResolvedValue(Response.json({ 'google-drive': true }))
    integrationMocks.services[0].accounts = [{ id: 'account-1', name: 'Trading' }]
    integrationMocks.disconnect.mockRejectedValueOnce(
      Object.assign(new Error('in use'), { code: 'EXTERNAL_SUBSCRIPTION_IN_USE' })
    )
    await renderPage()
    await click(integrationCopy.disconnect)
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      integrationCopy.failures.disconnectInUse
    )
  })

  it('serializes connection actions and exposes active progress', async () => {
    const connect = deferred()
    integrationMocks.connect.mockReturnValueOnce(connect.promise)
    await renderPage()
    const connectButton = action(integrationCopy.connect)
    await act(async () => {
      connectButton.click()
      connectButton.click()
      await flush()
    })
    expect(integrationMocks.connect).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(connectButton).toHaveTextContent(integrationCopy.connecting)
      expect(connectButton).toHaveAttribute('aria-busy', 'true')
    })

    await act(async () => {
      connect.resolve()
      await flush()
    })
    expect(connectButton).toHaveTextContent(integrationCopy.connect)
  })
})
