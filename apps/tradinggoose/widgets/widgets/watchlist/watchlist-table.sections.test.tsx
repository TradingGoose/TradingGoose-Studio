/**
 * @vitest-environment jsdom
 */

import {
  act,
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TouchEvent,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'

const mockDragActivation = vi.fn()
const mockResolveListing = vi.fn()
const mockEnsureListingSelectorInstance = vi.fn()
const mockUpdateListingSelectorInstance = vi.fn()
const mockResetListingSelectorInstance = vi.fn()
const mockStockSelectorRender = vi.fn()

vi.mock('@/components/listing-selector/listing/row', () => ({
  getListingPrimary: (listing: { name?: string; listing_id?: string }) =>
    listing.name ?? listing.listing_id ?? 'Listing',
  MarketListingRow: ({
    listing,
    className,
  }: {
    listing: { name?: string; listing_id?: string }
    className?: string
  }) => (
    <div data-testid='market-listing-row' className={className}>
      {listing.name ?? listing.listing_id ?? 'Listing'}
    </div>
  ),
}))

vi.mock('@/widgets/widgets/watchlist/components/stock-selector', () => ({
  StockSelector: ({
    instanceId,
    activateOnMount,
    onListingChange,
  }: {
    instanceId: string
    activateOnMount?: boolean
    onListingChange?: (listing: {
      listing_id: string
      base_id: string
      quote_id: string
      listing_type: 'default'
      name?: string
    }) => void
  }) => {
    mockStockSelectorRender({ instanceId, activateOnMount })
    return (
      <div data-testid={`stock-selector-${instanceId}`}>
        <button type='button' data-testid={`stock-selector-focus-${instanceId}`}>
          stock-selector-focus
        </button>
        <button
          type='button'
          data-testid={`stock-selector-select-${instanceId}`}
          onClick={() =>
            onListingChange?.({
              listing_id: 'eth-id',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
              name: 'ETH',
            })
          }
        >
          stock-selector-select
        </button>
      </div>
    )
  },
}))

vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: (...args: unknown[]) => mockResolveListing(...args),
}))

vi.mock('@/stores/market/selector/store', () => ({
  useListingSelectorStore: (
    selector: (state: {
      ensureInstance: typeof mockEnsureListingSelectorInstance
      updateInstance: typeof mockUpdateListingSelectorInstance
      resetInstance: typeof mockResetListingSelectorInstance
    }) => unknown
  ) =>
    selector({
      ensureInstance: mockEnsureListingSelectorInstance,
      updateInstance: mockUpdateListingSelectorInstance,
      resetInstance: mockResetListingSelectorInstance,
    }),
}))

vi.mock('@/components/ui/sortable', () => ({
  Sortable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SortableContent: ({ children, withoutSlot }: { children: ReactNode; withoutSlot?: boolean }) =>
    withoutSlot ? <>{children}</> : <div>{children}</div>,
  SortableItem: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
    if (!asChild) {
      return <div>{children}</div>
    }

    const child = Children.only(children)
    if (!isValidElement(child)) {
      return child
    }

    const element = child as ReactElement<{
      onMouseDown?: (event: MouseEvent<HTMLElement>) => void
      onTouchStart?: (event: TouchEvent<HTMLElement>) => void
    }>

    return cloneElement(element, {
      onMouseDown: (event) => {
        element.props.onMouseDown?.(event)
        if (!event.isPropagationStopped()) {
          mockDragActivation()
        }
      },
      onTouchStart: (event) => {
        element.props.onTouchStart?.(event)
        if (!event.isPropagationStopped()) {
          mockDragActivation()
        }
      },
    })
  },
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button data-testid='confirm-delete-section' type='button' {...props}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

const watchlist: WatchlistRecord = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Default',
  isSystem: true,
  items: [
    {
      id: 'section-1',
      type: 'section' as const,
      label: 'Section 1',
    },
    {
      id: 'listing-1',
      type: 'listing' as const,
      listing: {
        listing_id: 'BTC',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    },
  ],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const findButtonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text)
  )

const createTableProps = (overrides: Record<string, unknown> = {}) => ({
  watchlist,
  quotes: {},
  providerId: 'alpaca',
  onUpdateItemListing: vi.fn().mockResolvedValue(true),
  onReorderItems: vi.fn(),
  onRemoveItem: vi.fn(),
  onRenameSection: vi.fn(),
  onRemoveSection: vi.fn(),
  selectedListing: null,
  isLinkedSelection: false,
  onSelectListing: vi.fn(),
  ...overrides,
})

describe('WatchlistTable section interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockResolveListing.mockResolvedValue(null)
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

  it('lets the rename button open inline editing without triggering sortable drag activation', async () => {
    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps() as any)} />)
    })

    const renameButton = findButtonByText(container, 'Rename section')

    expect(renameButton).toBeTruthy()

    await act(async () => {
      renameButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      renameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const input = container.querySelector('input')

    expect(input).toBeTruthy()
    expect(input?.value).toBe('Section 1')

    await act(async () => {
      input?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()
  })

  it('renders watchlist rows with the requested surfaces and no outer chrome', async () => {
    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps() as any)} />)
    })

    const wrapper = container.firstElementChild as HTMLElement | null
    const header = container.querySelector('thead')
    const sectionRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Section 1')
    )
    const listingRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('BTC')
    )
    const marketListingRow = container.querySelector('[data-testid="market-listing-row"]')

    expect(container.textContent).toContain('Symbol')
    expect(container.textContent).toContain('Asset')
    expect(container.textContent).toContain('Change %')
    expect(header?.className).toContain('sticky')
    expect(wrapper?.className).not.toContain('m-1')
    expect(wrapper?.className).not.toContain('rounded')
    expect(wrapper?.className).not.toContain('border')
    expect(sectionRow?.className).toContain('bg-card')
    expect(listingRow).toBeTruthy()
    expect(listingRow?.className).toContain('bg-background')
    expect(marketListingRow?.className).toContain('w-full')
    expect(marketListingRow?.className).not.toContain('pl-6')
    expect(marketListingRow?.className).not.toContain('border')
    expect(marketListingRow?.className).not.toContain('rounded')
  })

  it('does not select a listing when the row itself is clicked', async () => {
    const onSelectListing = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            isLinkedSelection: true,
            onSelectListing,
          }) as any)}
        />
      )
    })

    const listingRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('BTC')
    )

    expect(listingRow).toBeTruthy()

    await act(async () => {
      listingRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).not.toHaveBeenCalled()
    expect(findButtonByText(container, 'Select symbol')).toBeTruthy()
    expect(findButtonByText(container, 'Deselect symbol')).toBeFalsy()
  })

  it('selects a listing through the select button in unlinked mode', async () => {
    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps() as any)} />)
    })

    const listingRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('BTC')
    )
    const selectButton = findButtonByText(container, 'Select symbol')

    expect(listingRow).toBeTruthy()
    expect(selectButton).toBeTruthy()

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const deselectButton = findButtonByText(container, 'Deselect symbol')

    expect(listingRow?.className).toContain('bg-accent')
    expect(deselectButton?.className).toContain('opacity-100')
    expect(deselectButton?.className).toContain('bg-accent')
  })

  it('blurs pointer-selected rows so action visibility can return to hover-only state', async () => {
    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps() as any)} />)
    })

    const selectButton = findButtonByText(container, 'Select symbol') as
      | HTMLButtonElement
      | undefined

    expect(selectButton).toBeTruthy()

    await act(async () => {
      selectButton?.focus()
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    })

    expect(document.activeElement).toBe(document.body)
  })

  it('does not activate drag when the select button is pressed before clicking', async () => {
    const onSelectListing = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            isLinkedSelection: true,
            onSelectListing,
          }) as any)}
        />
      )
    })

    const selectButton = findButtonByText(container, 'Select symbol')

    expect(selectButton).toBeTruthy()

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith({
      listing_id: 'BTC',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
  })

  it('calls the listing selection callback when the select button is clicked in linked mode', async () => {
    const onSelectListing = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            isLinkedSelection: true,
            onSelectListing,
          }) as any)}
        />
      )
    })

    const selectButton = findButtonByText(container, 'Select symbol')

    expect(selectButton).toBeTruthy()

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith({
      listing_id: 'BTC',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
  })

  it('keeps the selected check button visible for linked selections', async () => {
    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            isLinkedSelection: true,
            selectedListing: {
              listing_id: 'BTC',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          }) as any)}
        />
      )
    })

    const listingRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('BTC')
    )
    const selectButton = findButtonByText(container, 'Deselect symbol')

    expect(listingRow?.className).toContain('bg-accent')
    expect(selectButton?.className).toContain('opacity-100')
  })

  it('calls the listing selection callback with null when the selected button is clicked again', async () => {
    const onSelectListing = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            isLinkedSelection: true,
            onSelectListing,
            selectedListing: {
              listing_id: 'BTC',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          }) as any)}
        />
      )
    })

    const selectButton = findButtonByText(container, 'Deselect symbol')

    expect(selectButton).toBeTruthy()

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith(null)
  })

  it('opens delete confirmation from the section action and waits for delete success before closing', async () => {
    const deferred = createDeferred()
    const onRemoveSection = vi.fn().mockReturnValue(deferred.promise)

    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps({ onRemoveSection }) as any)} />)
    })

    const deleteButton = findButtonByText(container, 'Delete section')

    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Delete section?')

    const confirmButton = container.querySelector('[data-testid="confirm-delete-section"]')

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onRemoveSection).toHaveBeenCalledWith('section-1')
    expect(container.textContent).toContain('Delete section?')

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    expect(container.textContent).not.toContain('Delete section?')
  })

  it('opens delete confirmation from the symbol action and waits for delete success before closing', async () => {
    const deferred = createDeferred()
    const onRemoveItem = vi.fn().mockReturnValue(deferred.promise)

    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps({ onRemoveItem }) as any)} />)
    })

    const deleteButton = findButtonByText(container, 'Remove symbol')

    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Delete symbol?')

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    )

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onRemoveItem).toHaveBeenCalledWith('listing-1')
    expect(container.textContent).toContain('Delete symbol?')

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    expect(container.textContent).not.toContain('Delete symbol?')
  })

  it('opens inline symbol editing and commits the selected listing through the update callback', async () => {
    const onUpdateItemListing = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps({ onUpdateItemListing }) as any)} />)
    })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    expect(editButton).toBeTruthy()

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const selector = container.querySelector(
      '[data-testid="stock-selector-watchlist-listing-editor-listing-1"]'
    )

    expect(selector).toBeTruthy()
    expect(mockStockSelectorRender).toHaveBeenLastCalledWith({
      instanceId: 'watchlist-listing-editor-listing-1',
      activateOnMount: true,
    })

    const selectButton = container.querySelector(
      '[data-testid="stock-selector-select-watchlist-listing-editor-listing-1"]'
    )

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onUpdateItemListing).toHaveBeenCalledWith('listing-1', {
      listing_id: 'eth-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
  })

  it('updates linked selection when the selected listing is edited', async () => {
    const onUpdateItemListing = vi.fn().mockResolvedValue(true)
    const onSelectListing = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistTable
          {...(createTableProps({
            onUpdateItemListing,
            onSelectListing,
            isLinkedSelection: true,
            selectedListing: {
              listing_id: 'BTC',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          }) as any)}
        />
      )
    })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    expect(editButton).toBeTruthy()

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const selectButton = container.querySelector(
      '[data-testid="stock-selector-select-watchlist-listing-editor-listing-1"]'
    )

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onUpdateItemListing).toHaveBeenCalledWith('listing-1', {
      listing_id: 'eth-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(onSelectListing).toHaveBeenCalledWith({
      listing_id: 'eth-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
  })

  it('re-resolves and renders the updated listing when a persisted item changes to a new symbol', async () => {
    mockResolveListing
      .mockResolvedValueOnce({
        listing_id: 'BTC',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
        name: 'Bitcoin',
      })
      .mockResolvedValueOnce({
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
        name: 'Apple',
      })

    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps() as any)} />)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Bitcoin')

    const updatedWatchlist: WatchlistRecord = {
      ...watchlist,
      items: [
        watchlist.items[0],
        {
          ...watchlist.items[1],
          type: 'listing',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    }

    await act(async () => {
      root.render(
        <WatchlistTable {...(createTableProps({ watchlist: updatedWatchlist }) as any)} />
      )
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockResolveListing).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Apple')
    expect(container.textContent).not.toContain('Bitcoin')
  })

  it('keeps symbol edit mode active for internal clicks and cancels it on outside clicks without saving', async () => {
    const onUpdateItemListing = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps({ onUpdateItemListing }) as any)} />)
    })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const selector = container.querySelector(
      '[data-testid="stock-selector-watchlist-listing-editor-listing-1"]'
    )
    const focusButton = container.querySelector(
      '[data-testid="stock-selector-focus-watchlist-listing-editor-listing-1"]'
    )
    const editingRow = Array.from(container.querySelectorAll('tr')).find(
      (row) =>
        row.getAttribute('data-watchlist-listing-edit-surface') ===
        'watchlist-listing-edit-surface-listing-1'
    )
    const editingCell = selector?.closest('td')

    expect(selector).toBeTruthy()
    expect(editingRow?.className).toContain('relative')
    expect(editingCell?.className).toContain('z-20')

    await act(async () => {
      focusButton?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      focusButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(
      container.querySelector('[data-testid="stock-selector-watchlist-listing-editor-listing-1"]')
    ).toBeTruthy()
    expect(onUpdateItemListing).not.toHaveBeenCalled()

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })

    expect(
      container.querySelector('[data-testid="stock-selector-watchlist-listing-editor-listing-1"]')
    ).toBeNull()
    expect(onUpdateItemListing).not.toHaveBeenCalled()
  })
})
