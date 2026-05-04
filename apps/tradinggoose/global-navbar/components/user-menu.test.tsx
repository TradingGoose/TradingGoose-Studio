/**
 * @vitest-environment jsdom
 */

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as localeSwitcher from '@/app/(landing)/components/nav/locale-switcher'
import { getPublicCopy } from '@/i18n/public-copy'
import { UserMenu } from './user-menu'

const {
  useLocaleMock,
  usePathnameMock,
  useSearchParamsMock,
  useRouterMock,
  useOrganizationsMock,
  useOrganizationBillingMock,
  useSubscriptionDataMock,
  useGeneralStoreMock,
  generalStoreSetThemeMock,
  clearUserDataMock,
  signOutMock,
} = vi.hoisted(() => {
  const pushMock = vi.fn()
  const generalStoreState = {
    theme: 'dark',
    setTheme: vi.fn(),
    isLoading: false,
    isThemeLoading: false,
  }

  return {
    useLocaleMock: vi.fn(() => 'zh-CN'),
    usePathnameMock: vi.fn(() => '/workspace/ws-1/dashboard'),
    useSearchParamsMock: vi.fn(() => new URLSearchParams('from=nav&source=user-menu')),
    useRouterMock: vi.fn(() => ({ push: pushMock })),
    useOrganizationsMock: vi.fn(() => ({
      data: {
        activeOrganization: null,
        billingData: { data: { billingEnabled: false } },
      },
    })),
    useOrganizationBillingMock: vi.fn(() => ({ data: undefined, isLoading: false })),
    useSubscriptionDataMock: vi.fn(() => ({ data: undefined, isLoading: false })),
    useGeneralStoreMock: vi.fn((selector: (state: typeof generalStoreState) => unknown) =>
      selector(generalStoreState)
    ),
    generalStoreSetThemeMock: generalStoreState.setTheme,
    clearUserDataMock: vi.fn(),
    signOutMock: vi.fn(),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: usePathnameMock,
}))

vi.mock('@/lib/auth-client', () => ({
  signOut: signOutMock,
}))

vi.mock('@/stores', () => ({
  clearUserData: clearUserDataMock,
}))

vi.mock('@/lib/environment', () => ({
  isHosted: false,
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizations: useOrganizationsMock,
  useOrganizationBilling: useOrganizationBillingMock,
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useSubscriptionData: useSubscriptionDataMock,
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: useGeneralStoreMock,
}))

vi.mock('@/global-navbar/settings-modal/components/help/help-modal', () => ({
  HelpModal: () => null,
}))

vi.mock('@/components/ui/avatar', async () => {
  const React = await import('react')

  return {
    Avatar: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-slot': 'avatar' }, children),
    AvatarFallback: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-slot': 'avatar-fallback' }, children),
    AvatarImage: ({ alt, src }: { alt?: string; src?: string | null }) =>
      React.createElement('img', { alt: alt ?? '', src: src ?? '' }),
  }
})

vi.mock('@/components/ui/sidebar', async () => {
  const React = await import('react')

  return {
    SidebarMenu: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-slot': 'sidebar-menu' }, children),
    SidebarMenuItem: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-slot': 'sidebar-menu-item' }, children),
    SidebarMenuButton: React.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement>
    >(({ children, type = 'button', ...props }, ref) =>
      React.createElement('button', { ref, type, ...props }, children)
    ),
  }
})

vi.mock('./resizable-dropdown', async () => {
  const React = await import('react')

  const DropdownMenuContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  }>({
    open: false,
    setOpen: () => {},
  })

  const DropdownMenuSubContext = React.createContext<{
    open: boolean
    setOpen: React.Dispatch<React.SetStateAction<boolean>>
  }>({
    open: false,
    setOpen: () => {},
  })

  const DropdownMenuRadioContext = React.createContext<{
    value?: string
    onValueChange?: (value: string) => void
  }>({})

  const DropdownMenu = ({
    children,
    open,
    onOpenChange,
  }: {
    children?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const isControlled = typeof open === 'boolean'
    const currentOpen = isControlled ? open : internalOpen
    const setOpen = onOpenChange ?? setInternalOpen

    return React.createElement(
      DropdownMenuContext.Provider,
      { value: { open: currentOpen, setOpen } },
      children
    )
  }

  const DropdownMenuTrigger = ({
    asChild,
    children,
  }: {
    asChild?: boolean
    children?: React.ReactNode
  }) => {
    const context = React.useContext(DropdownMenuContext)

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
      const child = children as React.ReactElement<{
        onClick?: (event: React.MouseEvent<HTMLElement>) => void
      }> | null

      if (React.isValidElement(child) && typeof child.props.onClick === 'function') {
        child.props.onClick(event)
      }

      context.setOpen(!context.open)
    }

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<{ onClick?: typeof handleClick }>, {
        onClick: handleClick,
      })
    }

    return React.createElement('button', { type: 'button', onClick: handleClick }, children)
  }

  const DropdownMenuContent = ({
    children,
    className,
    sideOffset: _sideOffset,
    align: _align,
    ...props
  }: {
    children?: React.ReactNode
    className?: string
    sideOffset?: number
    align?: string
    [key: string]: unknown
  }) => {
    const context = React.useContext(DropdownMenuContext)

    if (!context.open) {
      return null
    }

    return React.createElement('div', { role: 'menu', className, ...props }, children)
  }

  const DropdownMenuGroup = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dropdown-menu-group' }, children)

  const DropdownMenuSub = ({ children }: { children?: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false)

    return React.createElement(
      DropdownMenuSubContext.Provider,
      { value: { open, setOpen } },
      children
    )
  }

  const DropdownMenuSubTrigger = ({
    children,
    className,
    disabled,
    onClick,
    ...props
  }: {
    children?: React.ReactNode
    className?: string
    disabled?: boolean
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    [key: string]: unknown
  }) => {
    const context = React.useContext(DropdownMenuSubContext)

    return React.createElement(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        'data-slot': 'dropdown-menu-sub-trigger',
        'aria-expanded': context.open,
        disabled,
        className,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          if (disabled) return
          onClick?.(event)
          context.setOpen((currentOpen) => !currentOpen)
        },
        ...props,
      },
      children
    )
  }

  const DropdownMenuSubContent = ({
    children,
    className,
    ...props
  }: {
    children?: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => {
    const context = React.useContext(DropdownMenuSubContext)

    if (!context.open) {
      return null
    }

    return React.createElement('div', { role: 'menu', 'data-slot': 'dropdown-menu-sub-content', className, ...props }, children)
  }

  const DropdownMenuItem = ({
    children,
    onSelect,
    ...props
  }: {
    children?: React.ReactNode
    onSelect?: (event: { preventDefault: () => void }) => void
    disabled?: boolean
  }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        'data-slot': 'dropdown-menu-item',
        onClick: onSelect,
        ...props,
      },
      children
    )

  const DropdownMenuLabel = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dropdown-menu-label' }, children)

  const DropdownMenuSeparator = () => React.createElement('hr', { 'aria-hidden': 'true' })

  const DropdownMenuRadioGroup = ({
    children,
    value,
    onValueChange,
  }: {
    children?: React.ReactNode
    value?: string
    onValueChange?: (value: string) => void
  }) =>
    React.createElement(
      DropdownMenuRadioContext.Provider,
      { value: { value, onValueChange } },
      React.createElement(
        'div',
        { role: 'radiogroup', 'data-slot': 'dropdown-menu-radio-group' },
        children
      )
    )

  const DropdownMenuRadioItem = ({
    children,
    className,
    disabled,
    onSelect,
    value,
    ...props
  }: {
    children?: React.ReactNode
    className?: string
    disabled?: boolean
    onSelect?: (event: { preventDefault: () => void }) => void
    value: string
    [key: string]: unknown
  }) => {
    const context = React.useContext(DropdownMenuRadioContext)
    const isSelected = context.value === value

    return React.createElement(
      'button',
      {
        type: 'button',
        role: 'menuitemradio',
        'data-slot': 'dropdown-menu-radio-item',
        'aria-checked': isSelected,
        'data-state': isSelected ? 'checked' : 'unchecked',
        disabled,
        className,
        onClick: (event: { preventDefault: () => void }) => {
          if (disabled) return
          if (onSelect) {
            onSelect(event)
            return
          }
          context.onValueChange?.(value)
        },
        ...props,
      },
      children
    )
  }

  return {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  }
})

describe('UserMenu selectors', () => {
  let container: HTMLDivElement
  let root: Root
  let navigateSpy: ReturnType<typeof vi.spyOn>

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  const renderMenu = async () => {
    await act(async () => {
      root.render(
        React.createElement(UserMenu, {
          userName: 'Alice',
          userEmail: 'alice@example.com',
          userAvatar: null,
          userAvatarVersion: null,
        })
      )
    })

    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes('Alice') && button.textContent?.includes('alice@example.com')
    )

    expect(trigger).toBeTruthy()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    useLocaleMock.mockReturnValue('zh-CN')
    usePathnameMock.mockReturnValue('/workspace/ws-1/dashboard')
    useSearchParamsMock.mockReturnValue(new URLSearchParams('from=nav&source=user-menu'))
    navigateSpy = vi.spyOn(localeSwitcher, 'navigateToLocaleHref').mockImplementation(() => {})
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

  it('renders localized menu items in the expected order', async () => {
    await renderMenu()

    const copy = getPublicCopy('zh-CN')
    const themeLabelPrefix = copy.workspace.userMenu.themeLabel.replace('{{theme}}', '')
    const selectorRow = container.querySelector('[data-slot="dropdown-menu-group"]')
    const selectorTriggers = container.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')
    const accountDetailLabel = copy.workspace.userMenu.accountDetail
    const helpSupportLabel = copy.workspace.userMenu.helpSupport
    const themeTrigger = Array.from(selectorTriggers).find((item) =>
      item.getAttribute('aria-label')?.includes(themeLabelPrefix)
    )
    const localeTrigger = Array.from(selectorTriggers).find((item) =>
      item.textContent?.includes(getPublicCopy('zh-CN').localeNames['zh-CN'])
    )
    const accountDetail = Array.from(
      container.querySelectorAll('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes(accountDetailLabel))
    const helpSupport = Array.from(container.querySelectorAll('[data-slot="dropdown-menu-item"]')).find(
      (item) => item.textContent?.includes(helpSupportLabel)
    )
    expect(selectorRow).toBeInTheDocument()
    expect(selectorTriggers.length).toBe(2)
    expect(themeTrigger).toBeInTheDocument()
    expect(localeTrigger).toBeInTheDocument()
    expect(accountDetail).toBeInTheDocument()
    expect(helpSupport).toBeInTheDocument()
    expect(accountDetail).toHaveTextContent(accountDetailLabel)
    expect(helpSupport).toHaveTextContent(helpSupportLabel)
    expect(localeTrigger).toHaveTextContent(copy.localeNames['zh-CN'])

    expect(
      selectorRow!.compareDocumentPosition(accountDetail!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      accountDetail!.compareDocumentPosition(helpSupport!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      themeTrigger!.compareDocumentPosition(localeTrigger!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('updates the theme when a different theme is selected', async () => {
    await renderMenu()

    const copy = getPublicCopy('zh-CN')
    const themeLabelPrefix = copy.workspace.userMenu.themeLabel.replace('{{theme}}', '')
    const themeTrigger = Array.from(
      container.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')
    ).find((item) => item.getAttribute('aria-label')?.includes(themeLabelPrefix))

    expect(themeTrigger).toBeInTheDocument()

    await act(async () => {
      themeTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const [lightTheme] = Array.from(container.querySelectorAll('[role="menuitemradio"]'))

    expect(lightTheme).toBeInTheDocument()

    await act(async () => {
      lightTheme?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(generalStoreSetThemeMock).toHaveBeenCalledWith('light')
  })

  it('navigates to the localized href when a different locale is selected', async () => {
    await renderMenu()

    const copy = getPublicCopy('zh-CN')
    const localeTrigger = Array.from(
      container.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')
    ).find((item) => item.textContent?.includes(copy.localeNames['zh-CN']))

    expect(localeTrigger).toBeInTheDocument()

    await act(async () => {
      localeTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const spanishItem = Array.from(container.querySelectorAll('[role="menuitemradio"]')).find(
      (item) => item.textContent?.includes(copy.localeNames.es)
    )

    expect(spanishItem).toBeInTheDocument()

    await act(async () => {
      spanishItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(navigateSpy).toHaveBeenCalledWith(
      '/es/workspace/ws-1/dashboard?from=nav&source=user-menu'
    )
  })

  it('does not navigate when the active locale is selected again', async () => {
    await renderMenu()

    const copy = getPublicCopy('zh-CN')
    const localeTrigger = Array.from(
      container.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')
    ).find((item) => item.textContent?.includes(copy.localeNames['zh-CN']))

    expect(localeTrigger).toBeInTheDocument()

    await act(async () => {
      localeTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const activeLocaleItem = Array.from(container.querySelectorAll('[role="menuitemradio"]')).find(
      (item) => item.textContent?.includes(copy.localeNames['zh-CN'])
    )

    expect(activeLocaleItem).toBeInTheDocument()

    await act(async () => {
      activeLocaleItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
