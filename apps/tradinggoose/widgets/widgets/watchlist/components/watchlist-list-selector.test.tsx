/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatchlistListSelector } from '@/widgets/widgets/watchlist/components/watchlist-list-selector'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({
    children,
    className,
    sideOffset: _sideOffset,
    align: _align,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { sideOffset?: number; align?: string }) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    className,
    ...props
  }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props} />
  ),
  AlertDialogCancel: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props} />
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderControlClassName: (className?: string) =>
    ['trigger', className].filter(Boolean).join(' '),
  widgetHeaderMenuContentClassName: 'content',
  widgetHeaderMenuItemClassName: 'item',
  widgetHeaderMenuTextClassName: 'text',
}))

const watchlists = [
  {
    id: 'default-watchlist',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'Default',
    isSystem: true,
    items: [],
    settings: { showLogo: true, showTicker: true, showDescription: true },
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
  },
  {
    id: 'favorites',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'Favorites',
    isSystem: false,
    items: [],
    settings: { showLogo: true, showTicker: true, showDescription: true },
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
  },
]

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('WatchlistListSelector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

  it('opens inline rename from the watchlist row action and submits the renamed value', async () => {
    const onRenameWatchlist = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(
        <WatchlistListSelector
          watchlists={watchlists as any}
          selectedWatchlist={watchlists[1] as any}
          onSelect={vi.fn()}
          onRenameWatchlist={onRenameWatchlist}
        />
      )
    })

    const renameButton = container.querySelector('[aria-label="Rename Favorites"]')

    expect(renameButton).toBeTruthy()

    await act(async () => {
      renameButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const input = container.querySelector('input[value="Favorites"]') as HTMLInputElement | null

    expect(input).toBeTruthy()

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'Tech')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onRenameWatchlist).toHaveBeenCalledWith('favorites', 'Tech')
  })

  it('uses indicator-style sizing for the selector trigger and dropdown', async () => {
    await act(async () => {
      root.render(
        <WatchlistListSelector
          watchlists={watchlists as any}
          selectedWatchlist={watchlists[1] as any}
          onSelect={vi.fn()}
        />
      )
    })

    const trigger = container.querySelector('button[aria-haspopup="listbox"]')
    const content = container.querySelector('.content')

    expect(trigger?.className).toContain('min-w-[220px]')
    expect(content?.className).toContain('w-[240px]')
  })

  it('opens the delete confirmation and deletes the selected watchlist', async () => {
    const onDeleteWatchlist = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(
        <WatchlistListSelector
          watchlists={watchlists as any}
          selectedWatchlist={watchlists[1] as any}
          onSelect={vi.fn()}
          onDeleteWatchlist={onDeleteWatchlist}
        />
      )
    })

    const deleteButton = container.querySelector('[aria-label="Delete Favorites"]')

    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(container.textContent).toContain('Delete watchlist?')

    const confirmButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete')
    )

    expect(confirmButton).toBeTruthy()

    await act(async () => {
      confirmButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onDeleteWatchlist).toHaveBeenCalledWith('favorites')
  })
})
