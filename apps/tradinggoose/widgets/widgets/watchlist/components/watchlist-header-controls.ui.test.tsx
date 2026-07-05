/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { usePairColorStore } from '@/stores/dashboard/pair-store'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetInstance } from '@/widgets/layout'
import { PAIR_COLORS } from '@/widgets/pair-colors'
import {
  WatchlistHeaderCenterControls,
  WatchlistHeaderRightControls,
} from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

const mockSetWatchlistItems = vi.fn()
const mockSetWatchlistName = vi.fn()
const mockSetWatchlistSettings = vi.fn()
const mockSaveWatchlistDocument = vi.fn()
const mockSaveSavedEntityField = vi.fn()
const mockEmitWatchlistParamsChange = vi.fn()
const mockEmitWatchlistSelectionChange = vi.fn()
const mockExportWatchlistAsJson = vi.fn()

const defaultWatchlist: WatchlistRecord = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  name: 'Watchlist 1',
  items: [],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
}
const secondWatchlist: WatchlistRecord = {
  ...defaultWatchlist,
  id: 'watchlist-2',
  name: 'Watchlist 2',
}
let currentWatchlists: WatchlistRecord[] = [defaultWatchlist]

const createWidget = (widget: NonNullable<WidgetInstance>): WidgetInstance => widget

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  saveSavedEntityField: (...args: unknown[]) => mockSaveSavedEntityField(...args),
  useEntityList: () => ({
    members: currentWatchlists.map((entry) => ({
      entityId: entry.id,
      entityName: entry.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useWatchlistYjsDocument: ({ watchlistId }: { watchlistId?: string | null }) => {
    const record = currentWatchlists.find((entry) => entry.id === watchlistId) ?? null
    return {
      record,
      name: record?.name ?? '',
      settings: record?.settings ?? { showLogo: true, showTicker: true, showDescription: true },
      items: record?.items ?? [],
      setName: mockSetWatchlistName,
      setSettings: mockSetWatchlistSettings,
      setItems: mockSetWatchlistItems,
      save: mockSaveWatchlistDocument,
      isLoading: false,
      error: null,
    }
  },
}))

vi.mock('@/widgets/utils/watchlist-params', () => ({
  emitWatchlistParamsChange: (...args: unknown[]) => mockEmitWatchlistParamsChange(...args),
}))

vi.mock('@/widgets/utils/watchlist-selection', () => ({
  emitWatchlistSelectionChange: (...args: unknown[]) => mockEmitWatchlistSelectionChange(...args),
}))

vi.mock('@/lib/watchlists/import-export', () => ({
  WATCHLIST_EXPORT_SOURCE: 'watchlistWidget',
  exportWatchlistAsJson: (...args: unknown[]) => mockExportWatchlistAsJson(...args),
}))

vi.mock('@/components/listing-selector/selector/input', () => ({
  ListingSearchInput: (props: {
    disabled?: boolean
    onListingChange?: (listing: {
      listing_id: string
      base_id: string
      quote_id: string
      listing_type: 'default'
      name?: string
    }) => void
  }) => (
    <button
      type='button'
      disabled={props.disabled}
      onClick={() =>
        props.onListingChange?.({
          listing_id: 'BTCUSD',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
          name: 'BTC/USD',
        })
      }
    >
      Select Listing
    </button>
  ),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-selector', () => ({
  WatchlistListSelector: (props: {
    selectedWatchlist?: { entityId: string } | null
    onSelect: (watchlistId: string) => void
  }) => (
    <div>
      watchlist-selector:{props.selectedWatchlist?.entityId ?? 'none'}
      <button type='button' onClick={() => props.onSelect('watchlist-2')}>
        Select Watchlist 2
      </button>
    </div>
  ),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-actions-button', () => ({
  WatchlistListActionsButton: (props: {
    createWatchlistDisabled?: boolean
    createSectionDisabled?: boolean
    exportDisabled?: boolean
    onCreateWatchlist: () => void
    onCreateSection: () => void
    onExport: () => void
  }) => (
    <>
      <button
        type='button'
        disabled={props.createWatchlistDisabled}
        onClick={props.onCreateWatchlist}
      >
        Create Watchlist
      </button>
      <button type='button' disabled={props.createSectionDisabled} onClick={props.onCreateSection}>
        Create Section
      </button>
      <button type='button' disabled={props.exportDisabled} onClick={props.onExport}>
        Export
      </button>
    </>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
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

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const resetPairStore = () => {
  usePairColorStore.setState({
    contexts: PAIR_COLORS.reduce<Record<(typeof PAIR_COLORS)[number], Record<string, never>>>(
      (acc, color) => {
        acc[color] = {}
        return acc
      },
      {} as Record<(typeof PAIR_COLORS)[number], Record<string, never>>
    ),
  })
}

describe('watchlist header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    currentWatchlists = [defaultWatchlist]
    resetPairStore()
    mockSaveWatchlistDocument.mockResolvedValue(undefined)
    mockSaveSavedEntityField.mockResolvedValue(undefined)
    mockExportWatchlistAsJson.mockReturnValue('{"watchlists":[]}')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useListingSelectorStore.setState({ instances: {} })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('adds the staged listing from the center header control through the selected Yjs document', async () => {
    await act(async () => {
      root.render(
        <WatchlistHeaderCenterControls
          workspaceId='workspace-1'
          panelId='panel-2'
          widget={createWidget({
            key: 'watchlist-widget',
            params: {
              watchlistId: 'watchlist-1',
              provider: 'alpaca',
            },
          })}
        />
      )
    })

    expect(container.firstElementChild?.className).toContain('min-w-0')

    const buttons = Array.from(container.querySelectorAll('button'))
    const listingButton = buttons.find((button) => button.textContent?.includes('Select Listing'))
    const addButton = buttons.find((button) =>
      button.textContent?.includes('Add listing to watchlist')
    )

    expect(listingButton).toBeTruthy()
    expect(addButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      listingButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(addButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      useListingSelectorStore
        .getState()
        .updateInstance('watchlist-header-listing-panel-2-watchlist-widget', {
          query: 'ETH',
          selectedListingValue: null,
          selectedListing: null,
        })
    })

    expect(addButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      listingButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(addButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      addButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'listing',
        listing: {
          listing_id: 'BTCUSD',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      }),
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
    expect(addButton?.hasAttribute('disabled')).toBe(true)
  })

  it('adds header listings before the first section so they stay root-level', async () => {
    const section = { id: 'section-1', type: 'section' as const, label: 'Tech' }
    const sectionListing = {
      id: 'listing-1',
      type: 'listing' as const,
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default' as const,
      },
    }
    currentWatchlists = [
      {
        ...defaultWatchlist,
        items: [section, sectionListing],
      },
    ]

    await act(async () => {
      root.render(
        <WatchlistHeaderCenterControls
          workspaceId='workspace-1'
          panelId='panel-2'
          widget={createWidget({
            key: 'watchlist-widget',
            params: {
              watchlistId: 'watchlist-1',
              provider: 'alpaca',
            },
          })}
        />
      )
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const listingButton = buttons.find((button) => button.textContent?.includes('Select Listing'))
    const addButton = buttons.find((button) =>
      button.textContent?.includes('Add listing to watchlist')
    )

    await act(async () => {
      listingButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      addButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'listing',
        listing: {
          listing_id: 'BTCUSD',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      }),
      section,
      sectionListing,
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
  })

  it('creates the next section name through the selected Yjs document', async () => {
    currentWatchlists = [
      {
        ...defaultWatchlist,
        items: [
          { id: 'section-1', type: 'section', label: 'Section 1' },
          { id: 'section-3', type: 'section', label: 'Section 3' },
        ],
      },
    ]

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({
            key: 'watchlist',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    expect(container.firstElementChild?.className).toContain('min-w-0')

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Create Section')
    )

    expect(button).toBeTruthy()
    expect(button?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      { id: 'section-1', type: 'section', label: 'Section 1' },
      { id: 'section-3', type: 'section', label: 'Section 3' },
      expect.objectContaining({
        type: 'section',
        label: 'Section 2',
      }),
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
  })

  it('dispatches watchlist selection without writing params directly for gray widgets', async () => {
    currentWatchlists = [defaultWatchlist, secondWatchlist]

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({
            key: 'watchlist',
            pairColor: 'gray',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Select Watchlist 2')
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(mockEmitWatchlistSelectionChange).toHaveBeenCalledWith({
      watchlistId: 'watchlist-2',
      panelId: 'panel-1',
      widgetKey: 'watchlist',
    })
    expect(mockEmitWatchlistParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: { watchlistId: 'watchlist-2' } })
    )
    expect(usePairColorStore.getState().contexts.gray.watchlistId).toBeUndefined()
  })

  it('stores selected watchlists in pair context for linked widgets', async () => {
    currentWatchlists = [defaultWatchlist, secondWatchlist]
    usePairColorStore.getState().setContext('blue', { watchlistId: 'watchlist-1' })

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({
            key: 'watchlist',
            pairColor: 'blue',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    expect(container.textContent).toContain('watchlist-selector:watchlist-1')

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Select Watchlist 2')
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(usePairColorStore.getState().contexts.blue.watchlistId).toBe('watchlist-2')
    expect(mockEmitWatchlistSelectionChange).toHaveBeenCalledWith({
      watchlistId: 'watchlist-2',
      panelId: 'panel-1',
      widgetKey: 'watchlist',
    })
    expect(mockEmitWatchlistParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: { watchlistId: 'watchlist-2' } })
    )
  })

  it('selects newly created watchlists through pair context for linked widgets', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        watchlist: {
          ...secondWatchlist,
          id: 'created-watchlist',
          name: 'Watchlist 2',
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)
    usePairColorStore.getState().setContext('red', { watchlistId: 'watchlist-1' })

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({
            key: 'watchlist',
            pairColor: 'red',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Create Watchlist')
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        name: 'Watchlist 2',
      }),
    })
    expect(usePairColorStore.getState().contexts.red.watchlistId).toBe('created-watchlist')
    expect(mockEmitWatchlistSelectionChange).toHaveBeenCalledWith({
      watchlistId: 'created-watchlist',
      panelId: 'panel-1',
      widgetKey: 'watchlist',
    })
  })

  it('imports watchlist files into the selected watchlist through the full-document import route', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn(),
    })
    vi.stubGlobal('fetch', mockFetch)

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-4'
          widget={createWidget({
            key: 'watchlist-widget',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = {
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'watchlistWidget',
          resourceTypes: ['watchlists'],
          watchlists: [
            {
              name: 'Watchlist 1',
              settings: { showLogo: true, showTicker: true, showDescription: true },
              items: [
                { id: 'section-tech', type: 'section', label: 'Tech' },
                {
                  id: 'listing-aapl',
                  type: 'listing',
                  listing: {
                    listing_id: 'aapl-id',
                    base_id: '',
                    quote_id: '',
                    listing_type: 'default',
                  },
                },
              ],
            },
          ],
        })
      ),
    } as unknown as File

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/watchlists/watchlist-1/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        file: {
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'watchlistWidget',
          resourceTypes: ['watchlists'],
          watchlists: [
            {
              name: 'Watchlist 1',
              settings: { showLogo: true, showTicker: true, showDescription: true },
              items: [
                { id: 'section-tech', type: 'section', label: 'Tech' },
                {
                  id: 'listing-aapl',
                  type: 'listing',
                  listing: {
                    listing_id: 'aapl-id',
                    base_id: '',
                    quote_id: '',
                    listing_type: 'default',
                  },
                },
              ],
            },
          ],
        },
      }),
    })
  })

  it('exports the selected Yjs watchlist document through the canonical export helper', async () => {
    currentWatchlists = [
      {
        ...defaultWatchlist,
        name: '!!!',
        items: [
          {
            id: 'listing-1',
            type: 'listing',
            listing: {
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
        ],
      },
    ]
    const fetchMock = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:watchlist-export')
    const revokeObjectURL = vi.fn()
    let downloadedName = ''
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement
    ) {
      downloadedName = this.download
    })

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-4'
          widget={createWidget({
            key: 'watchlist-widget',
            params: { watchlistId: 'watchlist-1' },
          })}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Export')
    )

    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockExportWatchlistAsJson).toHaveBeenCalledWith({
      fields: {
        name: '!!!',
        settings: { showLogo: true, showTicker: true, showDescription: true },
        items: currentWatchlists[0]!.items,
      },
      exportedFrom: 'watchlistWidget',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(downloadedName).toMatch(/^watchlist-1-\d{4}-/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:watchlist-export')
  })
})
