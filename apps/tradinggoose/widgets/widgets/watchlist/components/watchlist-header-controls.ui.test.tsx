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
const mockExportWatchlistAsJson = vi.fn()
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
    const selectedId = watchlistId ?? currentWatchlists[0]?.id ?? null
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

vi.mock('@/lib/watchlists/import-export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/watchlists/import-export')>(
    '@/lib/watchlists/import-export'
  )
  return {
    ...actual,
    exportWatchlistAsJson: (...args: unknown[]) => mockExportWatchlistAsJson(...args),
  }
})

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

  it('adds header listings as root items even when sections exist', async () => {
    const section = { id: 'section-1', type: 'section' as const, parentId: null, label: 'Tech' }
    const sectionListing = {
      id: 'listing-1',
      type: 'listing' as const,
      parentId: 'section-1',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default' as const,
      },
    }
    currentWatchlist = {
      ...rootWatchlist,
      items: [section, sectionListing],
    }
    currentWatchlists = [currentWatchlist]

    await act(async () => {
      root.render(
        <WatchlistHeaderCenterControls
          workspaceId='workspace-1'
          panelId='panel-2'
          widget={createWidget({
            key: 'watchlist-widget',
            params: { provider: 'alpaca' },
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
      section,
      sectionListing,
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

  it('imports watchlist files into the selected watchlist document', async () => {
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
          widget={createWidget({ key: 'watchlist-widget', params: {} })}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Import')
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const filePayload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-06T12:00:00.000Z',
      exportedFrom: 'watchlistWidget',
      resourceTypes: ['watchlists'],
      watchlists: [
        {
          name: 'Watchlist',
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [],
        },
      ],
    }
    const file = {
      text: vi.fn().mockResolvedValue(JSON.stringify(filePayload)),
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
        file: filePayload,
      }),
    })
  })

  it('exports the selected Yjs watchlist document through the canonical export helper', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      name: '!!!',
      items: [
        {
          id: 'listing-1',
          type: 'listing',
          parentId: null,
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    }
    currentWatchlists = [currentWatchlist]
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
          widget={createWidget({ key: 'watchlist-widget', params: {} })}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Export')
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockExportWatchlistAsJson).toHaveBeenCalledWith({
      fields: {
        name: '!!!',
        settings: { showLogo: true, showTicker: true, showDescription: true },
        items: currentWatchlist.items,
      },
      exportedFrom: 'watchlistWidget',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(downloadedName).toMatch(/^watchlist-1-\d{4}-/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:watchlist-export')
  })
})
