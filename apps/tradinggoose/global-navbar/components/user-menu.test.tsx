/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { SidebarProvider } from '@/components/ui/sidebar'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { UserMenu } from './user-menu'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
const mockSetTheme = vi.fn()
const mockUpdateSetting = vi.fn()
let mockPathname = '/workspace/ws-1/dashboard'
let mockSearchParams = ''

const generalState = {
  theme: 'system' as const,
  setTheme: mockSetTheme,
  updateSetting: mockUpdateSetting,
  isLoading: false,
  isThemeLoading: false,
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
const originalMatchMedia = window.matchMedia

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    toString: () => mockSearchParams,
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
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

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: (selector: (state: typeof generalState) => unknown) => selector(generalState),
}))

vi.mock('@/lib/auth-client', () => ({
  signOut: vi.fn(),
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

function renderUserMenu(root: Root, locale: LocaleCode) {
  root.render(
    <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
      <SidebarProvider>
        <UserMenu userName='Ada Lovelace' userEmail='ada@example.com' userId='user-1' />
      </SidebarProvider>
    </NextIntlClientProvider>
  )
}

async function openMenu(button: HTMLButtonElement) {
  button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

function getUserMenuButton(container: HTMLElement) {
  const button = container.querySelector('button[data-sidebar="menu-button"]')
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected user menu trigger to render')
  }

  return button
}

function getLanguageButton(localeDisplayName: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
    candidate.getAttribute('aria-label')?.endsWith(`: ${localeDisplayName}`)
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected language menu trigger to render')
  }

  return button
}

function getThemeButton(themeLabel: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === themeLabel
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${themeLabel} theme button to render`)
  }

  return button
}

async function selectLanguage(label: string) {
  const menuItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((item) =>
    item.textContent?.includes(label)
  )

  if (!(menuItem instanceof HTMLElement)) {
    throw new Error(`Expected ${label} menu item to render`)
  }

  menuItem.click()
  await flush()
}

describe('UserMenu language selector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  beforeEach(() => {
    mockPush.mockReset()
    mockReplace.mockReset()
    mockRefresh.mockReset()
    mockSetTheme.mockReset()
    mockUpdateSetting.mockReset()
    mockUpdateSetting.mockResolvedValue(undefined)
    mockPathname = '/workspace/ws-1/dashboard'
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
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    window.matchMedia = originalMatchMedia
  })

  it('renders the zh theme trigger label from the raw workspace template', async () => {
    await act(async () => {
      renderUserMenu(root, 'zh')
      await flush()
    })

    await act(async () => {
      await openMenu(getUserMenuButton(container))
    })

    expect(getThemeButton('主题：系统')).toBeInTheDocument()
  })

  it('switches to zh without dropping the workspace path or query string', async () => {
    mockSearchParams = 'layout=main'

    await act(async () => {
      renderUserMenu(root, 'en')
      await flush()
    })

    await act(async () => {
      await openMenu(getUserMenuButton(container))
      await openMenu(getLanguageButton('English'))
      await selectLanguage('简体中文')
    })

    expect(mockReplace).toHaveBeenCalledWith('/workspace/ws-1/dashboard?layout=main', {
      locale: 'zh',
    })
    expect(mockUpdateSetting).toHaveBeenCalledWith('preferredLocale', 'zh')
    expect(mockRefresh).not.toHaveBeenCalled()

    mockPathname = '/workspace/ws-1/dashboard'

    await act(async () => {
      renderUserMenu(root, 'en')
      await flush()
    })

    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('switches from zh to the default locale path', async () => {
    mockPathname = '/workspace/ws-1/dashboard'

    await act(async () => {
      renderUserMenu(root, 'zh')
      await flush()
    })

    await act(async () => {
      await openMenu(getUserMenuButton(container))
      await openMenu(getLanguageButton('简体中文'))
      await selectLanguage('English')
    })

    expect(mockReplace).toHaveBeenCalledWith('/workspace/ws-1/dashboard', { locale: 'en' })
    expect(mockUpdateSetting).toHaveBeenCalledWith('preferredLocale', 'en')
  })
})
