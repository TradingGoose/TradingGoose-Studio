/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import { getPublicCopy } from '@/i18n/public-copy'
import Nav from './nav'
import PublicNav from './public-nav'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
const mockReplaceLocaleDocument = vi.fn()
const mockUpdateSetting = vi.fn()
let mockSessionUserId: string | null = null
let mockPathname = '/'
let mockSearchParams = ''
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock('@/lib/registration/service', () => ({
  getRegistrationModeForRender: vi.fn(),
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
    data: mockSessionUserId ? { user: { id: mockSessionUserId } } : null,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: { updateSetting: typeof mockUpdateSetting }) => unknown) =>
    selector({ updateSetting: mockUpdateSetting }),
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
    mockUpdateSetting.mockResolvedValue(undefined)
    mockSessionUserId = null
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
      root.render(await PublicNav())
    })

    expect(getRegistrationModeForRender).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Login')
    expect(container.textContent).toContain(getPublicCopy('en').registration.waitlist.primary)
  })

  it('reuses an already resolved registration mode when provided', async () => {
    await act(async () => {
      root.render(await PublicNav({ registrationMode: 'disabled' }))
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
