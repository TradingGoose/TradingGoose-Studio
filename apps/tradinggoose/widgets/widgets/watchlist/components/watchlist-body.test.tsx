/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingIdentity } from '@/lib/listing/identity'
import { WatchlistWidgetBody } from '@/widgets/widgets/watchlist/components/watchlist-body'

const mockWatchlistTable = vi.fn()
const mockRefetchQuotes = vi.fn()
const mockSetWatchlistItems = vi.fn()
const mockSaveWatchlistDocument = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn((_request: unknown) => ({
  data: {},
  refetch: mockRefetchQuotes,
}))

const selectedListing: ListingIdentity = {
  listing_id: 'BTC',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}

const watchlist = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  name: 'Watchlist',
  items: [
    {
      id: 'listing-1',
      type: 'listing' as const,
      listing: selectedListing,
    },
  ],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-03-13T00:00:00.000Z',
  updatedAt: '2026-03-13T00:00:00.000Z',
}
let currentWatchlists: any[] = [watchlist]
let lastSelectedWatchlistArgs:
  | { watchlistId?: string | null; accessMode?: 'read' | 'write' }
  | undefined

vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useSelectedWatchlistYjsDocument: (args: {
    watchlistId?: string | null
    accessMode?: 'read' | 'write'
  }) => {
    lastSelectedWatchlistArgs = args
    const selectedId = args.watchlistId ?? currentWatchlists[0]?.id ?? null
    const record = currentWatchlists.find((entry) => entry.id === selectedId) ?? null
    return {
      record,
      name: record?.name ?? '',
      settings: record?.settings ?? { showLogo: true, showTicker: true, showDescription: true },
      items: record?.items ?? [],
      setName: vi.fn(),
      setSettings: vi.fn(),
      setItems: mockSetWatchlistItems,
      save: mockSaveWatchlistDocument,
      isLoading: false,
      error: null,
      members: currentWatchlists.map((entry) => ({
        entityId: entry.id,
        entityName: entry.name,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      selectedWatchlistId: selectedId,
    }
  },
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (request: unknown) => mockUseMarketQuoteSnapshots(request),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-table', () => ({
  WatchlistTable: (props: {
    selectedListing?: ListingIdentity | null
    isLinkedSelection?: boolean
    onSelectListing?: (listing: ListingIdentity | null) => void
    onRemoveContainer?: (containerId: string) => void
  }) => {
    mockWatchlistTable(props)
    return (
      <>
        <button type='button' onClick={() => props.onSelectListing?.(selectedListing)}>
          select-listing
        </button>
        <button type='button' onClick={() => props.onSelectListing?.(null)}>
          clear-listing
        </button>
        <button type='button' onClick={() => props.onRemoveContainer?.('section-1')}>
          remove-section
        </button>
      </>
    )
  },
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('WatchlistWidgetBody', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveWatchlistDocument.mockResolvedValue(undefined)
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    currentWatchlists = [watchlist]
    lastSelectedWatchlistArgs = undefined
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

  it('writes selected listings through the widget params patch callback when linked', async () => {
    const onWidgetParamsPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'select-listing'
    )

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing: null,
      })
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetParamsPatch).toHaveBeenCalledWith({ listing: selectedListing })

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: selectedListing }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing,
      })
    )
  })

  it('uses a read Yjs session and ignores listing selection when read-only', async () => {
    const onWidgetParamsPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1', canWrite: false }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(lastSelectedWatchlistArgs).toMatchObject({ accessMode: 'read' })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'select-listing'
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetParamsPatch).not.toHaveBeenCalled()
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: false,
        selectedListing: null,
        onSelectListing: undefined,
      })
    )
  })

  it('uses a read Yjs session but writes linked selection through widget params when workspace read-only', async () => {
    const onWidgetParamsPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1', canWrite: false }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(lastSelectedWatchlistArgs).toMatchObject({ accessMode: 'read' })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'select-listing'
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetParamsPatch).toHaveBeenCalledWith({ listing: selectedListing })
  })

  it('does not auto-claim the first watchlist when the widget is linked without a pair watchlist', async () => {
    const onWidgetParamsPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(onWidgetParamsPatch).not.toHaveBeenCalled()
    expect(mockWatchlistTable).toHaveBeenCalledWith(
      expect.objectContaining({
        watchlist,
        isLinkedSelection: true,
      })
    )
    expect(container.textContent).not.toContain('Select a watchlist.')
    expect(container.textContent).not.toContain('Create a watchlist to get started.')
  })

  it('clears linked selections through the widget params patch callback', async () => {
    const onWidgetParamsPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: selectedListing }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'clear-listing'
    )

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing,
      })
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetParamsPatch).toHaveBeenCalledWith({ listing: null })

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: null }}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing: null,
      })
    )
  })

  it('uses watchlist item ids as shared quote request keys', async () => {
    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{
            provider: 'alpaca',
            auth: { apiKey: '{{ ALPACA_API_KEY }}' },
            providerParams: { feed: 'iex' },
          }}
        />
      )
    })

    expect(mockUseMarketQuoteSnapshots).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [
        {
          key: 'listing-1',
          listing: selectedListing,
        },
      ],
      auth: { apiKey: '{{ ALPACA_API_KEY }}' },
      providerParams: { feed: 'iex' },
      refreshKey: null,
      enabled: true,
    })
  })

  it('uses runtime.refreshAt as the shared quote refresh key without refetching quotes directly', async () => {
    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{
            provider: 'alpaca',
            runtime: { refreshAt: 100 },
          }}
        />
      )
    })

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{
            provider: 'alpaca',
            runtime: { refreshAt: 200 },
          }}
        />
      )
    })

    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        refreshKey: 200,
      })
    )
    expect(mockRefetchQuotes).not.toHaveBeenCalled()
  })

  it('removes a section block and promotes direct children when deleting a section', async () => {
    currentWatchlists = [
      {
        ...watchlist,
        items: [
          {
            id: 'root-listing',
            type: 'listing' as const,
            parentId: null,
            listing: {
              listing_id: 'MSFT',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
          {
            id: 'section-1',
            type: 'section' as const,
            parentId: null,
            label: 'Tech',
          },
          {
            id: 'section-listing',
            type: 'listing' as const,
            parentId: 'section-1',
            listing: selectedListing,
          },
          {
            id: 'section-2',
            type: 'section' as const,
            parentId: null,
            label: 'Energy',
          },
          {
            id: 'next-section-listing',
            type: 'listing' as const,
            parentId: 'section-2',
            listing: {
              listing_id: 'XOM',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
        ],
      },
    ]

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{ provider: 'alpaca' }}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'remove-section'
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(mockSetWatchlistItems).toHaveBeenCalledWith([
      {
        id: 'root-listing',
        type: 'listing',
        parentId: null,
        listing: {
          listing_id: 'MSFT',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'section-listing',
        type: 'listing',
        parentId: null,
        listing: selectedListing,
      },
      {
        id: 'section-2',
        type: 'section',
        parentId: null,
        label: 'Energy',
      },
      {
        id: 'next-section-listing',
        type: 'listing',
        parentId: 'section-2',
        listing: {
          listing_id: 'XOM',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
    ])
    expect(mockSaveWatchlistDocument).toHaveBeenCalled()
  })
})
