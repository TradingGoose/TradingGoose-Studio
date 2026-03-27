import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'

const popoverMocks = vi.hoisted(() => {
  const Popover = ({ children }: { children: ReactNode }) => <div>{children}</div>
  const PopoverTrigger = ({ children }: { children: ReactNode }) => <div>{children}</div>
  const PopoverContent = ({ children }: { children: ReactNode }) => <div>{children}</div>

  return { Popover, PopoverTrigger, PopoverContent }
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

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuItemClassName: 'menu-item',
}))

const findElementByType = (
  node: ReactNode,
  matcher: (element: ReactElement) => boolean
): ReactElement | null => {
  if (!isValidElement(node)) return null
  if (matcher(node)) return node

  const children = Children.toArray((node.props as { children?: ReactNode }).children)
  for (const child of children) {
    const match = findElementByType(child, matcher)
    if (match) return match
  }

  return null
}

const createProps = () => ({
  open: true,
  onOpenChange: vi.fn(),
  onCreateWatchlist: vi.fn(),
  onCreateSection: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
  onDeleteWatchlist: vi.fn(),
})

const getMenuButtons = (tree: ReactNode) => {
  const content = findElementByType(tree, (element) => element.type === popoverMocks.PopoverContent)

  expect(content).not.toBeNull()

  return Children.toArray((content!.props as { children?: ReactNode }).children).filter(
    isValidElement
  ) as ReactElement[]
}

const findMenuButton = (items: ReactElement[], label: string) =>
  items.find((item) =>
    Children.toArray((item.props as { children?: ReactNode }).children).some(
      (child) =>
        isValidElement<{ children?: ReactNode }>(child) && child.props.children === label
    )
  ) as ReactElement<{ onClick?: () => void }> | undefined

describe('WatchlistListActionsButton', () => {
  it('prevents popover auto-focus when opening list actions', () => {
    const tree = WatchlistListActionsButton(createProps())
    const content = findElementByType(tree, (element) => element.type === popoverMocks.PopoverContent)

    expect(content).not.toBeNull()

    const onOpenAutoFocus = (
      content!.props as {
        onOpenAutoFocus?: (event: { preventDefault: () => void }) => void
      }
    ).onOpenAutoFocus

    expect(onOpenAutoFocus).toBeTypeOf('function')

    const preventDefault = vi.fn()
    onOpenAutoFocus?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('renders the reduced watchlist action set', () => {
    const props = createProps()
    const tree = WatchlistListActionsButton(props)
    const items = getMenuButtons(tree)

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
    const tree = WatchlistListActionsButton(props)
    const trigger = findElementByType(tree, (element) => element.type === 'button')

    expect(trigger).not.toBeNull()
    expect((trigger!.props as { className?: string }).className).toContain('icon-button')

    const items = getMenuButtons(tree)
    const createWatchlistButton = findMenuButton(items, 'Create Watchlist')

    expect(createWatchlistButton?.props.onClick).toBeTypeOf('function')

    createWatchlistButton?.props.onClick?.()

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onCreateWatchlist).toHaveBeenCalledOnce()
  })

  it('closes menu before running create section action', () => {
    const props = createProps()
    const tree = WatchlistListActionsButton(props)
    const items = getMenuButtons(tree)
    const createSectionButton = findMenuButton(items, 'Create Section')

    expect(createSectionButton?.props.onClick).toBeTypeOf('function')

    createSectionButton?.props.onClick?.()

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onCreateSection).toHaveBeenCalledOnce()
  })

  it('hides disabled actions instead of rendering disabled menu buttons', () => {
    const tree = WatchlistListActionsButton({
      ...createProps(),
      importDisabled: true,
      deleteWatchlistDisabled: true,
    })

    const items = getMenuButtons(tree)

    expect(findMenuButton(items, 'Add Symbol')).toBeUndefined()
    expect(findMenuButton(items, 'Import')).toBeUndefined()
    expect(findMenuButton(items, 'Clear list')).toBeUndefined()
    expect(findMenuButton(items, 'Delete watchlist')).toBeUndefined()
    expect(findMenuButton(items, 'Create Watchlist')).toBeTruthy()
    expect(findMenuButton(items, 'Create Section')).toBeTruthy()
    expect(findMenuButton(items, 'Export')).toBeTruthy()
  })

  it('disables the trigger when every action is unavailable', () => {
    const tree = WatchlistListActionsButton({
      ...createProps(),
      createWatchlistDisabled: true,
      createSectionDisabled: true,
      importDisabled: true,
      exportDisabled: true,
      deleteWatchlistDisabled: true,
    })

    const trigger = findElementByType(tree, (element) => element.type === 'button')
    const content = findElementByType(tree, (element) => element.type === popoverMocks.PopoverContent)

    expect((trigger?.props as { disabled?: boolean } | undefined)?.disabled).toBe(true)
    expect(content).toBeNull()
  })
})
