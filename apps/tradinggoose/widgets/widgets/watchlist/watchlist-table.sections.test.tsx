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
import type { WatchlistListingItem, WatchlistRecord } from '@/lib/watchlists/types'
import {
  createWatchlistContainerSortableId,
  createWatchlistListingSortableId,
  WATCHLIST_ROOT_SORTABLE_ID,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'

const mockDragActivation = vi.fn()
const mockSortableRender = vi.fn()
const mockResolveListing = vi.fn()
const mockEnsureListingSelectorInstance = vi.fn()
const mockUpdateListingSelectorInstance = vi.fn()
const mockResetListingSelectorInstance = vi.fn()
const mockStockSelectorRender = vi.fn()

type SortableDragEvent = {
  active: { id: string; rect: { current: { translated: { top: number } } } }
  over: { id: string; rect: { top: number } }
}

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

vi.mock('@/components/listing-selector/selector/input', () => ({
  ListingSearchInput: ({
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
  Sortable: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    mockSortableRender(props)
    return <div>{children}</div>
  },
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

const btcListing = {
  listing_id: 'BTC',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

const listing = (
  id: string,
  parentId: string | null = null,
  listingId = id
): WatchlistListingItem => ({
  id,
  type: 'listing',
  parentId,
  listing: { ...btcListing, listing_id: listingId },
})

const watchlist: WatchlistRecord = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  name: 'Growth',
  items: [
    {
      id: 'section-1',
      type: 'section' as const,
      parentId: null,
      label: 'Section 1',
    },
    listing('listing-1', 'section-1', 'BTC'),
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

const findRowByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('tr')).find((row) => row.textContent?.includes(text))

const createTableProps = (overrides: Record<string, unknown> = {}) => ({
  watchlist,
  quotes: {},
  providerId: 'alpaca',
  onUpdateItemListing: vi.fn().mockResolvedValue(true),
  onMoveItem: vi.fn(),
  onRemoveItem: vi.fn(),
  onRenameContainer: vi.fn(),
  onRemoveContainer: vi.fn(),
  selectedListing: null,
  onSelectListing: vi.fn(),
  ...overrides,
})

describe('WatchlistTable section interactions', () => {
  let container: HTMLDivElement
  let root: Root

  async function renderTable(overrides: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(<WatchlistTable {...(createTableProps(overrides) as any)} />)
    })
  }

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
    await renderTable()

    const renameButton = findButtonByText(container, 'Rename section')

    expect(renameButton).toBeTruthy()

    await act(async () => {
      renameButton?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      renameButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const input = container.querySelector('input')

    expect(input).toBeTruthy()
    expect(input?.value).toBe('Section 1')

    await act(async () => {
      input?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()
  })

  it.each([
    [watchlist, createWatchlistContainerSortableId('section-1'), WATCHLIST_ROOT_SORTABLE_ID, null],
    [
      {
        ...watchlist,
        items: [listing('root-a'), listing('root-b'), ...watchlist.items],
      },
      createWatchlistListingSortableId('root-a'),
      createWatchlistListingSortableId('root-a'),
      'root-a',
    ],
  ])(
    'resolves a nested listing at the top edge without losing its exact target',
    async (record, overId, expectedId, highlightedListing) => {
      const onMoveItem = vi.fn().mockResolvedValue(undefined)

      await renderTable({ watchlist: record, onMoveItem })

      const sortableProps = mockSortableRender.mock.lastCall?.[0] as {
        onDragOver: (event: SortableDragEvent) => void
        onMove: (event: SortableDragEvent) => void
      }
      const nestedId = createWatchlistListingSortableId('listing-1')
      const event = {
        active: { id: nestedId, rect: { current: { translated: { top: 100 } } } },
        over: { id: overId, rect: { top: 100 } },
      }

      act(() => sortableProps.onDragOver(event))
      if (highlightedListing) {
        expect(findRowByText(container, highlightedListing)?.className).toContain('bg-primary/10')
      }

      act(() => sortableProps.onMove(event))
      expect(onMoveItem).toHaveBeenCalledWith(nestedId, expectedId)
    }
  )

  it('renders watchlist rows with the requested surfaces and no outer chrome', async () => {
    await renderTable({
      watchlist: {
        ...watchlist,
        items: [
          { id: 'section-1', type: 'section', parentId: null, label: 'Section 1' },
          listing('root-listing', null, 'ROOT'),
        ],
      },
    })

    const wrapper = container.firstElementChild as HTMLElement | null
    const header = container.querySelector('thead')
    const sectionRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Section 1')
    )
    const listingRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('ROOT')
    )
    const marketListingRow = container.querySelector('[data-testid="market-listing-row"]')
    const bodyRows = Array.from(container.querySelectorAll('tbody tr')).map(
      (row) => row.textContent ?? ''
    )

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
    expect(bodyRows.findIndex((row) => row.includes('Section 1'))).toBeLessThan(
      bodyRows.findIndex((row) => row.includes('ROOT'))
    )
  })

  it('formats watchlist item numbers with two decimal digits', async () => {
    await renderTable({
      quotes: {
        'listing-1': {
          lastPrice: 123.4567,
          change: -0.9876,
          changePercent: 4.3219,
        },
      },
    })

    const listingRow = findRowByText(container, 'BTC')

    expect(listingRow).toBeTruthy()
    expect(listingRow?.textContent).toContain('123.46')
    expect(listingRow?.textContent).toContain('-0.99')
    expect(listingRow?.textContent).toContain('4.32%')
    expect(listingRow?.textContent).not.toContain('123.4567')
    expect(listingRow?.textContent).not.toContain('-0.9876')
    expect(listingRow?.textContent).not.toContain('4.3219%')
  })

  it('selects a listing through the controlled callback', async () => {
    const onSelectListing = vi.fn()

    await renderTable({ onSelectListing })

    const listingRow = findRowByText(container, 'BTC')

    expect(listingRow).toBeTruthy()

    await act(async () => {
      listingRow?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith(btcListing)
  })

  it('lets a reader select a listing while entity mutations are disabled', async () => {
    const onSelectListing = vi.fn()
    await renderTable({ isMutating: true, onSelectListing })

    const listingRow = findRowByText(container, 'BTC')

    expect(listingRow).toBeTruthy()

    await act(async () => {
      listingRow?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith(btcListing)
  })

  it('keeps the controlled selected row highlighted', async () => {
    await renderTable({
      selectedListing: btcListing,
    })

    const listingRow = findRowByText(container, 'BTC')

    expect(listingRow?.className).toContain('bg-accent')
    expect(findButtonByText(container, 'Deselect symbol')).toBeFalsy()
  })

  it('calls the listing selection callback with null when the selected row is clicked again', async () => {
    const onSelectListing = vi.fn()

    await renderTable({
      onSelectListing,
      selectedListing: btcListing,
    })

    const listingRow = findRowByText(container, 'BTC')

    expect(listingRow).toBeTruthy()

    await act(async () => {
      listingRow?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectListing).toHaveBeenCalledWith(null)
  })

  it('opens delete confirmation from the section action and waits for delete success before closing', async () => {
    const deferred = createDeferred()
    const onRemoveContainer = vi.fn().mockReturnValue(deferred.promise)

    await renderTable({ onRemoveContainer })

    const deleteButton = findButtonByText(container, 'Delete section')

    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Delete section?')

    const confirmButton = container.querySelector('[data-testid="confirm-delete-section"]')

    await act(async () => {
      confirmButton?.dispatchEvent(
        new globalThis.MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    expect(onRemoveContainer).toHaveBeenCalledWith('section-1')
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

    await renderTable({ onRemoveItem })

    const deleteButton = findButtonByText(container, 'Remove symbol')

    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
    })

    expect(mockDragActivation).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Delete symbol?')

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    )

    await act(async () => {
      confirmButton?.dispatchEvent(
        new globalThis.MouseEvent('click', { bubbles: true, cancelable: true })
      )
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
    const onSelectListing = vi.fn()

    await renderTable({ onUpdateItemListing, onSelectListing })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    expect(editButton).toBeTruthy()

    await act(async () => {
      editButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
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
      selectButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onUpdateItemListing).toHaveBeenCalledWith('listing-1', {
      listing_id: 'eth-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(onSelectListing).not.toHaveBeenCalled()
  })

  it('updates controlled selection when the selected listing is edited', async () => {
    const onUpdateItemListing = vi.fn().mockResolvedValue(true)
    const onSelectListing = vi.fn()

    await renderTable({
      onUpdateItemListing,
      onSelectListing,
      selectedListing: btcListing,
    })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    expect(editButton).toBeTruthy()

    await act(async () => {
      editButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const selectButton = container.querySelector(
      '[data-testid="stock-selector-select-watchlist-listing-editor-listing-1"]'
    )

    await act(async () => {
      selectButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
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

    await renderTable()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Bitcoin')
    })

    const updatedWatchlist: WatchlistRecord = {
      ...watchlist,
      items: [watchlist.items[0], listing('listing-1', 'section-1', 'AAPL')],
    }

    await renderTable({ watchlist: updatedWatchlist })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(mockResolveListing).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('Apple')
      expect(container.textContent).not.toContain('Bitcoin')
    })
  })

  it('keeps symbol edit mode active for internal clicks and cancels it on outside clicks without saving', async () => {
    const onUpdateItemListing = vi.fn().mockResolvedValue(true)

    await renderTable({ onUpdateItemListing })

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit symbol')
    )

    await act(async () => {
      editButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
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
      focusButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
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
