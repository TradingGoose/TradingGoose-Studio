/**
 * @vitest-environment jsdom
 */

import type { ComponentProps, ReactNode } from 'react'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '@/i18n/messages/en.json'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'

const popoverMocks = vi.hoisted(() => {
  const state: {
    contentProps: { onOpenAutoFocus?: (event: { preventDefault: () => void }) => void } | null
  } = {
    contentProps: null,
  }
  const Popover = ({ children }: { children: ReactNode }) => <div>{children}</div>
  const PopoverTrigger = ({ children }: { children: ReactNode }) => <div>{children}</div>
  const PopoverContent = ({
    children,
    ...props
  }: {
    children: ReactNode
    onOpenAutoFocus?: (event: { preventDefault: () => void }) => void
  }) => {
    state.contentProps = props
    return <div data-testid='popover-content'>{children}</div>
  }

  return { Popover, PopoverTrigger, PopoverContent, state }
})

vi.mock('@/components/ui/popover', () => ({
  Popover: popoverMocks.Popover,
  PopoverTrigger: popoverMocks.PopoverTrigger,
  PopoverContent: popoverMocks.PopoverContent,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuItemClassName: 'menu-item',
}))

type WatchlistListActionsButtonTestProps = ComponentProps<typeof WatchlistListActionsButton>

const createProps = (): WatchlistListActionsButtonTestProps => ({
  open: true,
  onOpenChange: vi.fn(),
  onCreateWatchlist: vi.fn(),
  onCreateSection: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
  onDeleteWatchlist: vi.fn(),
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const getMenuButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="popover-content"] button'))

const findMenuButton = (items: Element[], label: string) =>
  items.find((item) => item.textContent === label) as HTMLButtonElement | undefined

describe('WatchlistListActionsButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    popoverMocks.state.contentProps = null
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

  it('prevents popover auto-focus when opening list actions', () => {
    renderActionsButton()

    const onOpenAutoFocus = popoverMocks.state.contentProps?.onOpenAutoFocus
    expect(onOpenAutoFocus).toBeTypeOf('function')

    const preventDefault = vi.fn()
    onOpenAutoFocus?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('renders the reduced watchlist action set', () => {
    const props = createProps()
    renderActionsButton(props)
    const items = getMenuButtons(container)

    expect(items).toHaveLength(5)
    expect(findMenuButton(items, 'Add Symbol')).toBeUndefined()
    expect(findMenuButton(items, 'Clear list')).toBeUndefined()
    expect(findMenuButton(items, 'Create Watchlist')).toBeTruthy()
    expect(findMenuButton(items, 'Create Section')).toBeTruthy()
    expect(findMenuButton(items, 'Import')).toBeTruthy()
    expect(findMenuButton(items, 'Export')).toBeTruthy()
    expect(findMenuButton(items, 'Delete watchlist')).toBeTruthy()
  })

  it('renders an icon-only trigger and closes menu before running create watchlist action', () => {
    const props = createProps()
    renderActionsButton(props)
    const trigger = container.querySelector('button')

    expect(trigger).not.toBeNull()
    expect(trigger?.className).toContain('icon-button')

    const items = getMenuButtons(container)
    const createWatchlistButton = findMenuButton(items, 'Create Watchlist')

    expect(createWatchlistButton).toBeInstanceOf(HTMLButtonElement)

    act(() => {
      createWatchlistButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onCreateWatchlist).toHaveBeenCalledOnce()
  })

  it('closes menu before running create section action', () => {
    const props = createProps()
    renderActionsButton(props)
    const items = getMenuButtons(container)
    const createSectionButton = findMenuButton(items, 'Create Section')

    expect(createSectionButton).toBeInstanceOf(HTMLButtonElement)

    act(() => {
      createSectionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onCreateSection).toHaveBeenCalledOnce()
  })

  it('hides disabled actions instead of rendering disabled menu buttons', () => {
    renderActionsButton({
      ...createProps(),
      importDisabled: true,
      deleteWatchlistDisabled: true,
    })

    const items = getMenuButtons(container)

    expect(findMenuButton(items, 'Add Symbol')).toBeUndefined()
    expect(findMenuButton(items, 'Import')).toBeUndefined()
    expect(findMenuButton(items, 'Clear list')).toBeUndefined()
    expect(findMenuButton(items, 'Delete watchlist')).toBeUndefined()
    expect(findMenuButton(items, 'Create Watchlist')).toBeTruthy()
    expect(findMenuButton(items, 'Create Section')).toBeTruthy()
    expect(findMenuButton(items, 'Export')).toBeTruthy()
  })

  it('disables the trigger when every action is unavailable', () => {
    renderActionsButton({
      ...createProps(),
      createWatchlistDisabled: true,
      createSectionDisabled: true,
      importDisabled: true,
      exportDisabled: true,
      deleteWatchlistDisabled: true,
    })

    const trigger = container.querySelector('button')
    const content = container.querySelector('[data-testid="popover-content"]')

    expect(trigger?.disabled).toBe(true)
    expect(content).toBeNull()
  })
})
