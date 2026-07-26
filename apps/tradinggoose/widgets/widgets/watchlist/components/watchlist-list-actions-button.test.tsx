/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '@/i18n/messages/en.json'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid='menu-content'>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: (event: Event) => void }) => (
    <button type='button' {...props} onClick={(event) => onSelect?.(event.nativeEvent)}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuContentClassName: 'menu-content',
  widgetHeaderMenuIconClassName: 'menu-icon',
  widgetHeaderMenuItemClassName: 'menu-item',
  widgetHeaderMenuTextClassName: 'menu-text',
}))

type WatchlistListActionsButtonTestProps = ComponentProps<typeof WatchlistListActionsButton>

const createProps = (): WatchlistListActionsButtonTestProps => ({
  onCreateList: vi.fn(),
  onCreateSection: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const getMenuButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="menu-content"] button'))

const findMenuButton = (items: Element[], label: string) =>
  items.find((item) => item.textContent === label) as HTMLButtonElement | undefined

describe('WatchlistListActionsButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderActionsButton = (props: WatchlistListActionsButtonTestProps = createProps()) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale='en' messages={enMessages}>
          <WatchlistListActionsButton {...props} />
        </NextIntlClientProvider>
      )
    })
  }

  it('renders the watchlist action set as dropdown menu items', () => {
    renderActionsButton()
    const items = getMenuButtons(container)

    expect(items).toHaveLength(4)
    expect(findMenuButton(items, 'Create List')).toBeTruthy()
    expect(findMenuButton(items, 'Create Section')).toBeTruthy()
    expect(findMenuButton(items, 'Import')).toBeTruthy()
    expect(findMenuButton(items, 'Export')).toBeTruthy()
    expect(findMenuButton(items, 'Add Symbol')).toBeUndefined()
    expect(findMenuButton(items, 'Delete watchlist')).toBeUndefined()
  })

  it('renders an icon-only trigger and runs the create list action on select', () => {
    const props = createProps()
    renderActionsButton(props)
    const trigger = container.querySelector('button')

    expect(trigger).not.toBeNull()
    expect(trigger?.className).toContain('icon-button')

    const items = getMenuButtons(container)
    const createListButton = findMenuButton(items, 'Create List')

    expect(createListButton).toBeInstanceOf(HTMLButtonElement)

    act(() => {
      createListButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(props.onCreateList).toHaveBeenCalledOnce()
  })

  it('shows disabled actions as disabled menu items instead of hiding them', () => {
    const props = { ...createProps(), importDisabled: true }
    renderActionsButton(props)
    const items = getMenuButtons(container)

    expect(items).toHaveLength(4)
    const importButton = findMenuButton(items, 'Import')
    expect(importButton?.disabled).toBe(true)
    expect(findMenuButton(items, 'Create List')?.disabled).toBe(false)
    expect(findMenuButton(items, 'Create Section')?.disabled).toBe(false)
    expect(findMenuButton(items, 'Export')?.disabled).toBe(false)

    act(() => {
      importButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(props.onImport).not.toHaveBeenCalled()
  })

  it('disables the trigger when every action is unavailable', () => {
    renderActionsButton({
      ...createProps(),
      createListDisabled: true,
      createSectionDisabled: true,
      importDisabled: true,
      exportDisabled: true,
    })

    const trigger = container.querySelector('button')
    const items = getMenuButtons(container)

    expect(trigger?.disabled).toBe(true)
    expect(items.every((item) => (item as HTMLButtonElement).disabled)).toBe(true)
  })
})
