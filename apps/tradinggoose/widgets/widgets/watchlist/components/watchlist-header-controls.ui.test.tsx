/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { WATCHLIST_WIDGET_SELECT_EVENT } from '@/widgets/events'
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

const rootWatchlist: WatchlistRecord = {
  id: 'workspace-1',
  workspaceId: 'workspace-1',
  name: 'Watchlist',
  items: [],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
}
let currentWatchlist: WatchlistRecord = rootWatchlist

const createWidget = (widget: NonNullable<WidgetInstance>): WidgetInstance => widget

vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useWatchlistYjsDocument: ({ watchlistId }: { watchlistId?: string | null }) => {
    const record = watchlistId === currentWatchlist.id ? currentWatchlist : null
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

  it('adds the staged listing through the workspace root Yjs document', async () => {
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

  it('creates the next section name through the workspace root Yjs document', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      items: [
        { id: 'section-1', type: 'section', parentId: null, label: 'Section 1' },
        { id: 'section-3', type: 'section', parentId: null, label: 'Section 3' },
      ],
    }

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

  it('shows the implicit root list with localized copy instead of the root document name', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      name: 'Internal Root Name',
      items: [{ id: 'list-1', type: 'list', parentId: null, label: 'Watchlist 1' }],
    }

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({ key: 'watchlist', params: {} })}
        />
      )
    })

    expect(container.textContent).toContain('Default')
    expect(container.textContent).not.toContain('Internal Root Name')

    const dropdownTrigger = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Explorer'
    )

    await act(async () => {
      if (!dropdownTrigger) return
      const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
      dropdownTrigger.dispatchEvent(
        new PointerEventCtor('pointerdown', { bubbles: true, button: 0 } as MouseEventInit)
      )
      dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
      dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const rootRowButton = Array.from(document.body.querySelectorAll('button')).find(
      (candidate) =>
        candidate.getAttribute('aria-label') !== 'Explorer' &&
        candidate.textContent?.includes('Default')
    )
    const renameButtons = Array.from(document.body.querySelectorAll('button')).filter(
      (candidate) => candidate.getAttribute('aria-label') === 'Rename List'
    )

    expect(rootRowButton).toBeTruthy()
    expect(renameButtons).toHaveLength(1)
  })

  it('selects the implicit root list instead of starting list rename', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      items: [
        { id: 'list-1', type: 'list', parentId: null, label: 'Watchlist 1' },
        { id: 'section-1', type: 'section', parentId: 'list-1', label: 'Section 1' },
      ],
    }
    const selectionEvents: unknown[] = []
    const handleSelection = (event: Event) => {
      selectionEvents.push((event as CustomEvent).detail)
    }
    window.addEventListener(WATCHLIST_WIDGET_SELECT_EVENT, handleSelection)

    try {
      await act(async () => {
        root.render(
          <WatchlistHeaderRightControls
            workspaceId='workspace-1'
            panelId='panel-1'
            widget={createWidget({ key: 'watchlist', params: { watchlistId: 'list-1' } })}
          />
        )
      })

      const dropdownTrigger = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.getAttribute('aria-label') === 'Explorer'
      )

      await act(async () => {
        if (!dropdownTrigger) return
        const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
        dropdownTrigger.dispatchEvent(
          new PointerEventCtor('pointerdown', { bubbles: true, button: 0 } as MouseEventInit)
        )
        dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
        dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      })

      const rootRowButton = Array.from(document.body.querySelectorAll('button')).find(
        (candidate) =>
          candidate.getAttribute('aria-label') !== 'Explorer' &&
          candidate.textContent?.includes('Default')
      )

      await act(async () => {
        rootRowButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      })

      expect(selectionEvents).toContainEqual({
        watchlistId: null,
        panelId: 'panel-1',
        widgetKey: 'watchlist',
      })
      expect(document.body.querySelector('input[aria-label="Rename List"]')).toBeNull()
    } finally {
      window.removeEventListener(WATCHLIST_WIDGET_SELECT_EVENT, handleSelection)
    }
  })

  it('renames the selected custom list through the workspace root Yjs document', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      items: [
        { id: 'list-1', type: 'list', parentId: null, label: 'Watchlist 1' },
        { id: 'section-1', type: 'section', parentId: 'list-1', label: 'Section 1' },
      ],
    }

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({ key: 'watchlist', params: { watchlistId: 'list-1' } })}
        />
      )
    })

    const dropdownTrigger = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Explorer'
    )

    await act(async () => {
      if (!dropdownTrigger) return
      const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
      dropdownTrigger.dispatchEvent(
        new PointerEventCtor('pointerdown', { bubbles: true, button: 0 } as MouseEventInit)
      )
      dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
      dropdownTrigger?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const renameButton = Array.from(document.body.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Rename List'
    )

    expect(renameButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      renameButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const input = document.body.querySelector(
      'input[aria-label="Rename List"]'
    ) as HTMLInputElement | null

    expect(input?.value).toBe('Watchlist 1')

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'Momentum')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      { id: 'list-1', type: 'list', parentId: null, label: 'Momentum' },
      { id: 'section-1', type: 'section', parentId: 'list-1', label: 'Section 1' },
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
  })

  it('removes a custom list from the dropdown and promotes direct children to root', async () => {
    currentWatchlist = {
      ...rootWatchlist,
      items: [
        { id: 'list-1', type: 'list', parentId: null, label: 'Watchlist 1' },
        { id: 'section-1', type: 'section', parentId: 'list-1', label: 'Section 1' },
        {
          id: 'listing-1',
          type: 'listing',
          parentId: 'list-1',
          listing: {
            listing_id: 'MSFT',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    }

    await act(async () => {
      root.render(
        <WatchlistHeaderRightControls
          workspaceId='workspace-1'
          panelId='panel-1'
          widget={createWidget({ key: 'watchlist', params: { watchlistId: 'list-1' } })}
        />
      )
    })

    const dropdownTrigger = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Explorer'
    )

    await act(async () => {
      if (!dropdownTrigger) return
      const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
      dropdownTrigger.dispatchEvent(
        new PointerEventCtor('pointerdown', { bubbles: true, button: 0 } as MouseEventInit)
      )
      dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true }))
      dropdownTrigger.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    const deleteButton = Array.from(document.body.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Delete List'
    )

    expect(deleteButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      deleteButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Delete'
    )

    await act(async () => {
      confirmButton?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      { id: 'section-1', type: 'section', parentId: null, label: 'Section 1' },
      {
        id: 'listing-1',
        type: 'listing',
        parentId: null,
        listing: {
          listing_id: 'MSFT',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalledTimes(1)
  })

  it('imports watchlist files into the workspace root watchlist', async () => {
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

    expect(mockFetch).toHaveBeenCalledWith('/api/watchlists/workspace-1/import', {
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
    expect(downloadedName).toMatch(/^workspace-1-\d{4}-/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:watchlist-export')
  })
})
