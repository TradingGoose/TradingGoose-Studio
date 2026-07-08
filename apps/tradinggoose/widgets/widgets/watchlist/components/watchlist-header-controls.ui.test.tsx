/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetInstance } from '@/widgets/layout'
import {
  WatchlistHeaderCenterControls,
  WatchlistHeaderRightControls,
} from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

const mockSetWatchlistItems = vi.fn()
const mockSetWatchlistName = vi.fn()
const mockSetWatchlistSettings = vi.fn()
const mockSaveWatchlistDocument = vi.fn()
const mockPatchWidgetParams = vi.fn()

const rootWatchlist: WatchlistRecord = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  name: 'Watchlist',
  items: [],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
}
let currentWatchlist: WatchlistRecord = rootWatchlist
let currentWatchlists: WatchlistRecord[] = [rootWatchlist]

const createWidget = (widget: NonNullable<WidgetInstance>): WidgetInstance => widget

vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useSelectedWatchlistYjsDocument: ({ watchlistId }: { watchlistId?: string | null }) => {
    const selectedId = watchlistId
      ? (currentWatchlists.find((watchlist) => watchlist.id === watchlistId)?.id ?? null)
      : (currentWatchlists[0]?.id ?? null)
    const record = currentWatchlists.find((watchlist) => watchlist.id === selectedId) ?? null
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
      members: currentWatchlists.map((watchlist) => ({
        entityId: watchlist.id,
        entityName: watchlist.name,
        createdAt: watchlist.createdAt,
        updatedAt: watchlist.updatedAt,
      })),
      selectedWatchlistId: selectedId,
    }
  },
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: (...args: unknown[]) => mockPatchWidgetParams(...args),
  }),
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

vi.mock('@/widgets/widgets/watchlist/components/watchlist-list-actions-button', () => ({
  WatchlistListActionsButton: (props: {
    createListDisabled?: boolean
    createSectionDisabled?: boolean
    exportDisabled?: boolean
    importDisabled?: boolean
    onCreateList: () => void
    onCreateSection: () => void
    onExport: () => void
    onImport: () => void
  }) => (
    <>
      <button type='button' disabled={props.createListDisabled} onClick={props.onCreateList}>
        Create List
      </button>
      <button type='button' disabled={props.createSectionDisabled} onClick={props.onCreateSection}>
        Create Section
      </button>
      <button type='button' disabled={props.importDisabled} onClick={props.onImport}>
        Import
      </button>
      <button type='button' disabled={props.exportDisabled} onClick={props.onExport}>
        Export
      </button>
    </>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderControlClassName: (className?: string) =>
    ['control', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuContentClassName: 'menu-content',
  widgetHeaderMenuItemClassName: 'menu-item',
  widgetHeaderMenuTextClassName: 'menu-text',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('watchlist header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    currentWatchlist = rootWatchlist
    currentWatchlists = [rootWatchlist]
    mockSaveWatchlistDocument.mockResolvedValue(undefined)
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

  it('adds the staged listing through the selected Yjs document', async () => {
    await act(async () => {
      root.render(
        <WatchlistHeaderCenterControls
          workspaceId='workspace-1'
          panelId='panel-2'
          widget={createWidget({
            key: 'watchlist-widget',
            params: { provider: 'alpaca' },
          })}
          canMutateWatchlist
        />
      )
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const listingButton = buttons.find((button) => button.textContent?.includes('Select Listing'))
    const addButton = buttons.find((button) =>
      button.textContent?.includes('Add listing to watchlist')
    )

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
        parentId: null,
        listing: {
          listing_id: 'BTCUSD',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      }),
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
  })

  it('creates the next section name through the selected Yjs document', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      items: [
        { id: 'section-1', type: 'section', parentId: null, label: 'Section 1' },
        { id: 'section-3', type: 'section', parentId: null, label: 'Section 3' },
      ],
    }
    currentWatchlists = [currentWatchlist]

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({ key: 'watchlist', params: {} })}
          canEditWidgetParams
          canMutateWatchlist
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Create Section')
    )

    expect(button?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      { id: 'section-1', type: 'section', parentId: null, label: 'Section 1' },
      { id: 'section-3', type: 'section', parentId: null, label: 'Section 3' },
      expect.objectContaining({
        type: 'section',
        parentId: null,
        label: 'Section 2',
      }),
    ])
  })

  it('allows widget-param updates while keeping watchlist mutations disabled', async () => {
    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-4'
          widget={createWidget({ key: 'watchlist-widget', params: { provider: 'alpaca' } })}
          canEditWidgetParams
          canMutateWatchlist={false}
        />
      )
    })

    const button = (label: string) =>
      Array.from(container.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes(label)
      )
    const refreshButton = button('Refresh')

    expect(button('Create List')?.hasAttribute('disabled')).toBe(true)
    expect(button('Import')?.hasAttribute('disabled')).toBe(true)
    expect(refreshButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      refreshButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith('panel-4', 'watchlist-widget', {
      runtime: { refreshAt: expect.any(Number) },
    })
    expect(mockSetWatchlistItems).not.toHaveBeenCalled()
    expect(mockSaveWatchlistDocument).not.toHaveBeenCalled()
  })

  it('does not fall back to the first watchlist when the widget references a stale watchlist id', async () => {
    currentWatchlist = { ...rootWatchlist, name: 'Primary Watchlist' }
    currentWatchlists = [currentWatchlist]

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-5'
          widget={createWidget({ key: 'watchlist', params: { watchlistId: 'missing-watchlist' } })}
          canEditWidgetParams
          canMutateWatchlist
        />
      )
    })

    const watchlistButton = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Watchlist')
    )

    expect(watchlistButton?.textContent).toContain('Watchlist')
    expect(watchlistButton?.textContent).not.toContain(currentWatchlist.name)
    expect(watchlistButton?.hasAttribute('disabled')).toBe(true)
  })
})
