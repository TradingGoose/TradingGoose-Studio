/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import Nav from './nav'
import PublicNav from './public-nav'
import * as localeSwitcher from './locale-switcher'

const { useLocaleMock, usePathnameMock, useSearchParamsMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'en'),
  usePathnameMock: vi.fn(() => '/blog'),
  useSearchParamsMock: vi.fn(() => new URLSearchParams('')),
}))

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react')

  const DropdownMenuContext = React.createContext<{
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }>({})

  const DropdownMenu = ({
    children,
    open,
    onOpenChange,
  }: {
    children?: any
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <DropdownMenuContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DropdownMenuContext.Provider>
  )

  const DropdownMenuTrigger = ({
    asChild,
    children,
  }: {
    asChild?: boolean
    children?: any
  }) => {
    const context = React.useContext(DropdownMenuContext)

    const handleClick = (event: any) => {
      const child = children as React.ReactElement<any> | null

      if (React.isValidElement(child) && typeof (child.props as any).onClick === 'function') {
        ;(child.props as any).onClick(event)
      }

      context.onOpenChange?.(!context.open)
    }

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, {
        onClick: handleClick,
      } as any)
    }

    return (
      <button type='button' onClick={handleClick}>
        {children}
      </button>
    )
  }

  const DropdownMenuContent = ({
    children,
    className,
    ...props
  }: any) => {
    const context = React.useContext(DropdownMenuContext)

    if (!context.open) {
      return null
    }

    return (
      <div className={className} role='menu' {...props}>
        {children}
      </div>
    )
  }

  const DropdownMenuGroup = ({ children }: { children?: any }) => <div>{children}</div>

  const DropdownMenuItem = ({
    children,
    className,
    onSelect,
    ...props
  }: any) => (
    <button type='button' role='menuitem' className={className} onClick={onSelect} {...props}>
      {children}
    </button>
  )

  const DropdownMenuSeparator = () => <hr aria-hidden='true' />

  return {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  }
})

vi.mock('@/lib/registration/service', () => ({
  getRegistrationModeForRender: vi.fn(),
}))

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
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode
    href: string
    prefetch?: boolean
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: usePathnameMock,
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

describe('landing nav registration mode', () => {
  let container: HTMLDivElement
  let root: Root
  let navigateSpy: ReturnType<typeof vi.spyOn>

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    useLocaleMock.mockReturnValue('en')
    usePathnameMock.mockReturnValue('/blog')
    useSearchParamsMock.mockReturnValue(new URLSearchParams(''))
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

  it('uses the shared landing nav for public pages via PublicNav', async () => {
    vi.mocked(getRegistrationModeForRender).mockResolvedValue('waitlist')

    await act(async () => {
      root.render(await PublicNav())
    })

    expect(getRegistrationModeForRender).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Blog')
    expect(container.textContent).toContain('Login')
    expect(container.textContent).toContain('Join Waitlist')
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

  it('navigates to the locale-prefixed URL when the language changes', async () => {
    vi.mocked(getRegistrationModeForRender).mockResolvedValue('waitlist')
    usePathnameMock.mockReturnValue('/blog')
    useSearchParamsMock.mockReturnValue(new URLSearchParams('from=nav&source=landing'))

    await act(async () => {
      root.render(await PublicNav())
    })

    const trigger = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('English')
    )

    expect(trigger).toBeTruthy()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const zhLocaleItem = Array.from(container.querySelectorAll('[role="menuitem"]')).find((item) =>
      item.textContent?.includes('简体中文')
    )

    expect(zhLocaleItem).toBeTruthy()

    await act(async () => {
      zhLocaleItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(navigateSpy).toHaveBeenCalledWith('/zh/blog?from=nav&source=landing')
  })

  it('does not render auth controls when auth buttons are hidden', async () => {
    await act(async () => {
      root.render(<Nav variant='auth' hideAuthButtons />)
    })

    expect(container.textContent).not.toContain('Login')
    expect(container.textContent).not.toContain('Sign up')
    expect(container.textContent).not.toContain('Join Waitlist')
  })
})
