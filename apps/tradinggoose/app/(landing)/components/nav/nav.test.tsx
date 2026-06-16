/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { getPublicCopy } from '@/i18n/public-copy'
import Nav from './nav'
import PublicNav from './public-nav'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
const mockReplaceLocaleDocument = vi.fn()
const mockUpdateSetting = vi.fn()
const mockSetTheme = vi.fn()
let mockSessionUser: {
  id: string
  email: string
  name?: string | null
  image?: string | null
  updatedAt?: Date
} | null = null
let mockSessionPending = false
let mockPathname = '/'
let mockSearchParams = ''
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock('@/lib/registration/service', () => ({
  getRegistrationModeForRender: vi.fn(),
}))

vi.mock('@/lib/admin/access', () => ({
  getSystemAdminAccess: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    toString: () => mockSearchParams,
  }),
}))

vi.mock('next/image', () => ({
  default: ({
    alt,
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    <img alt={alt ?? ''} {...props} />
  ),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    children?: React.ReactNode
    href: string | { pathname?: string }
    prefetch?: boolean
  }) => (
    <a href={typeof href === 'string' ? href : (href.pathname ?? '')} {...props}>
      {children}
    </a>
  ),
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  replaceLocaleDocument: (...args: Parameters<typeof mockReplaceLocaleDocument>) =>
    mockReplaceLocaleDocument(...args),
}))

vi.mock('@/app/fonts/soehne/soehne', () => ({
  soehne: { className: '' },
}))

vi.mock('@/app/(landing)/actions/github', () => ({
  getFormattedGitHubStars: vi.fn(async () => '0'),
}))

vi.mock('@/lib/branding/branding', () => ({
  useBrandConfig: () => ({
    name: 'TradingGoose',
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: mockSessionUser ? { user: mockSessionUser } : null,
    isPending: mockSessionPending,
    error: null,
    refetch: vi.fn(),
  }),
  signOut: vi.fn(),
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (
    selector: (state: {
      theme: 'system'
      setTheme: typeof mockSetTheme
      updateSetting: typeof mockUpdateSetting
      isLoading: boolean
      isThemeLoading: boolean
    }) => unknown
  ) =>
    selector({
      theme: 'system',
      setTheme: mockSetTheme,
      updateSetting: mockUpdateSetting,
      isLoading: false,
      isThemeLoading: false,
    }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizations: () => ({
    data: {
      activeOrganization: null,
      billingData: { data: { billingEnabled: false } },
    },
  }),
  useOrganizationBilling: () => ({ data: null }),
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useSubscriptionData: () => ({
    data: { billingEnabled: false },
    isLoading: false,
  }),
}))

vi.mock('@/lib/billing/billing-portal', () => ({
  openBillingPortal: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isHosted: false,
}))

vi.mock('@/stores', () => ({
  clearUserData: vi.fn(),
}))

vi.mock('@/global-navbar/settings-modal/components/help/help-modal', () => ({
  HelpModal: () => null,
}))

vi.mock('@/global-navbar/settings-modal/settings-dialog', () => ({
  SettingsDialog: ({
    open,
    section,
  }: {
    open: boolean
    section: string
    onOpenChange: (open: boolean) => void
  }) => (open ? <div data-testid='settings-dialog'>{section}</div> : null),
}))

describe('landing nav registration mode', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    vi.mocked(getRegistrationModeForRender).mockReset()
    vi.mocked(getSystemAdminAccess).mockResolvedValue({
      session: null,
      user: null,
      userId: null,
      isAuthenticated: false,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    })
    mockUpdateSetting.mockResolvedValue(undefined)
    mockSetTheme.mockResolvedValue(undefined)
    mockSessionUser = null
    mockSessionPending = false
    mockPathname = '/'
    mockSearchParams = ''
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

  it('uses the shared landing nav for public pages via PublicNav', async () => {
    vi.mocked(getRegistrationModeForRender).mockResolvedValue('waitlist')

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          {await PublicNav()}
        </NextIntlClientProvider>
      )
    })

    expect(getRegistrationModeForRender).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Login')
    expect(container.textContent).toContain(getPublicCopy('en').registration.waitlist.primary)
  })

  it('reuses an already resolved registration mode when provided', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          {await PublicNav({ registrationMode: 'disabled' })}
        </NextIntlClientProvider>
      )
    })

    expect(getRegistrationModeForRender).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Coming soon')
    expect(container.textContent).not.toContain('Login')
  })

  it('renders public nav from scoped nav and registration messages', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Nav registrationMode='open' />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(getPublicCopy('en').nav.docs)
    expect(container.textContent).toContain(getPublicCopy('en').nav.blog)
    expect(container.textContent).toContain(getPublicCopy('en').registration.open.primary)
  })

  it('replaces login and registration controls with profile and dashboard actions for authenticated users', async () => {
    mockSessionUser = {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      image: '/avatar.png',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Nav registrationMode='open' />
        </NextIntlClientProvider>
      )
      await flush()
    })

    expect(container.textContent).not.toContain(getPublicCopy('en').nav.login)
    expect(container.textContent).not.toContain(getPublicCopy('en').registration.open.primary)
    expect(container.textContent).toContain(getPublicCopy('en').nav.goToDashboard)
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('English')
      )
    ).toBe(false)

    const profileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Ada Lovelace Account Detail'
    )
    expect(profileButton).toBeInstanceOf(HTMLButtonElement)

    const dashboardLinks = Array.from(container.querySelectorAll('a')).filter(
      (link) => link.textContent === getPublicCopy('en').nav.goToDashboard
    )
    expect(dashboardLinks.some((link) => link.getAttribute('href') === '/workspace')).toBe(true)
  })

  it('shows the same system admin menu item on PublicNav for authenticated system admins', async () => {
    mockSessionPending = true
    vi.mocked(getSystemAdminAccess).mockResolvedValue({
      session: {},
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin User',
      },
      userId: 'admin-1',
      isAuthenticated: true,
      isSystemAdmin: true,
      canBootstrapSystemAdmin: false,
    } as Awaited<ReturnType<typeof getSystemAdminAccess>>)

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          {await PublicNav({ registrationMode: 'open' })}
        </NextIntlClientProvider>
      )
      await flush()
    })

    const profileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Admin User Account Detail'
    )
    if (!(profileButton instanceof HTMLButtonElement)) {
      throw new Error('Expected authenticated profile menu trigger')
    }

    await act(async () => {
      profileButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      profileButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      profileButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    const systemAdminItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.includes(getPublicCopy('en').workspace.nav.systemAdmin)
    )

    expect(systemAdminItem).toBeInstanceOf(HTMLElement)

    await act(async () => {
      systemAdminItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    expect(mockPush).toHaveBeenCalledWith('/admin')
  })

  it('clears server authenticated nav state after the client session resolves signed out', async () => {
    const authenticatedUser = {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    }

    mockSessionPending = true
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Nav registrationMode='open' authenticatedUser={authenticatedUser} />
        </NextIntlClientProvider>
      )
      await flush()
    })

    expect(container.textContent).toContain(getPublicCopy('en').nav.goToDashboard)

    mockSessionPending = false
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Nav registrationMode='open' authenticatedUser={authenticatedUser} />
        </NextIntlClientProvider>
      )
      await flush()
    })

    expect(container.textContent).not.toContain(getPublicCopy('en').nav.goToDashboard)
    expect(container.textContent).toContain(getPublicCopy('en').nav.login)
    expect(container.textContent).toContain(getPublicCopy('en').registration.open.primary)
  })

  it('opens account settings from the authenticated landing profile menu', async () => {
    mockSessionUser = {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <Nav registrationMode='open' />
        </NextIntlClientProvider>
      )
      await flush()
    })

    const profileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Ada Lovelace Account Detail'
    )
    if (!(profileButton instanceof HTMLButtonElement)) {
      throw new Error('Expected authenticated profile menu trigger')
    }

    await act(async () => {
      profileButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      profileButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      profileButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    const accountItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('Account Detail')
    )
    if (!(accountItem instanceof HTMLElement)) {
      throw new Error('Expected account menu item')
    }

    await act(async () => {
      accountItem.click()
      await flush()
    })

    expect(container.querySelector('[data-testid="settings-dialog"]')?.textContent).toBe('account')
  })

  it('does not render auth controls when auth buttons are hidden', async () => {
    await act(async () => {
      root.render(<Nav variant='auth' hideAuthButtons />)
    })

    expect(container.textContent).not.toContain('Login')
    expect(container.textContent).not.toContain('Sign up')
    expect(container.textContent).not.toContain(getPublicCopy('en').registration.waitlist.primary)
  })

  it('shows locale names in their native language on the landing switcher', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <Nav variant='auth' hideAuthButtons />
        </NextIntlClientProvider>
      )
    })

    const languageButton = container.querySelector('button')
    if (!(languageButton instanceof HTMLButtonElement)) {
      throw new Error('Expected language switcher button to render')
    }

    expect(languageButton.textContent).toBe('Español')
  })

  it('switches locales without dropping the current path or query string', async () => {
    mockPathname = '/blog/trading-signals'
    mockSearchParams = 'from=nav&campaign=i18n'

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <Nav variant='auth' hideAuthButtons />
        </NextIntlClientProvider>
      )
    })

    const languageButton = container.querySelector('button')
    if (!(languageButton instanceof HTMLButtonElement)) {
      throw new Error('Expected language switcher button to render')
    }

    await act(async () => {
      languageButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      languageButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      languageButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const menuItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((item) =>
      item.textContent?.includes('简体中文')
    )

    if (!(menuItem instanceof HTMLElement)) {
      throw new Error('Expected Chinese locale menu item to render')
    }

    await act(async () => {
      menuItem.click()
      await flush()
    })

    expect(mockUpdateSetting).not.toHaveBeenCalled()
    expect(mockReplaceLocaleDocument).toHaveBeenCalledWith(
      'zh',
      '/blog/trading-signals?from=nav&campaign=i18n'
    )
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()

    mockPathname = '/blog/trading-signals'

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <Nav variant='auth' hideAuthButtons />
        </NextIntlClientProvider>
      )
    })

    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
