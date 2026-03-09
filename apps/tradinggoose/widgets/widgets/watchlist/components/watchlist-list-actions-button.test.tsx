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
  widgetHeaderControlClassName: () => 'control',
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
  onImport: vi.fn(),
  onExport: vi.fn(),
  onClearList: vi.fn(),
  onResetOrder: vi.fn(),
  onDeleteWatchlist: vi.fn(),
})

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

  it('closes menu before running import action', () => {
    const props = createProps()
    const tree = WatchlistListActionsButton(props)
    const content = findElementByType(tree, (element) => element.type === popoverMocks.PopoverContent)

    expect(content).not.toBeNull()

    const items = Children.toArray((content!.props as { children?: ReactNode }).children).filter(
      isValidElement
    ) as ReactElement[]
    const importButton = items[0] as ReactElement<{ onClick?: () => void }>

    expect(items).toHaveLength(5)
    expect(importButton.props.onClick).toBeTypeOf('function')

    importButton.props.onClick?.()

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onImport).toHaveBeenCalledOnce()
  })
})
