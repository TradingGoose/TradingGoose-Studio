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
    const selectedId = args.watchlistId
      ? (currentWatchlists.find((entry) => entry.id === args.watchlistId)?.id ?? null)
      : (currentWatchlists[0]?.id ?? null)
    const record = currentWatchlists.find((entry) => entry.id === selectedId) ?? null
    return {
      record,
      name: record?.name ?? '',
      settings: record?.settings ?? { showLogo: true, showTicker: true, showDescription: true },
      items: record?.items ?? [],
      updateItems: (update: (items: unknown[]) => unknown[]) =>
        mockSetWatchlistItems(update(record?.items ?? [])),
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

  it('writes selected listings through the explicit pair callback when linked', async () => {
    const onWidgetParamsPatch = vi.fn()
    const onWidgetColorPairPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'select-listing'
    )

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedListing: null,
      })
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetColorPairPatch).toHaveBeenCalledWith({ listing: selectedListing })
    expect(onWidgetParamsPatch).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: selectedListing }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
        />
      )
    })

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedListing,
      })
    )
  })

  it('uses a read Yjs session while persisting gray listing selection to widget params', async () => {
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

    expect(onWidgetParamsPatch).toHaveBeenCalledWith({ listing: selectedListing })
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedListing: null,
        onSelectListing: expect.any(Function),
      })
    )
  })

  it('uses a read Yjs session but writes linked selection through the pair callback', async () => {
    const onWidgetParamsPatch = vi.fn()
    const onWidgetColorPairPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1', canWrite: false }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
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

    expect(onWidgetColorPairPatch).toHaveBeenCalledWith({ listing: selectedListing })
    expect(onWidgetParamsPatch).not.toHaveBeenCalled()
  })

  it('does not auto-claim the first watchlist when the widget is linked without a pair watchlist', async () => {
    const onWidgetParamsPatch = vi.fn()
    const onWidgetColorPairPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca' }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
        />
      )
    })

    expect(onWidgetParamsPatch).not.toHaveBeenCalled()
    expect(onWidgetColorPairPatch).not.toHaveBeenCalled()
    expect(mockWatchlistTable).toHaveBeenCalledWith(
      expect.objectContaining({
        watchlist,
      })
    )
    expect(container.textContent).not.toContain('Select a watchlist.')
    expect(container.textContent).not.toContain('Create a watchlist to get started.')
  })

  it('clears linked selections through the explicit pair callback', async () => {
    const onWidgetParamsPatch = vi.fn()
    const onWidgetColorPairPatch = vi.fn()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: selectedListing }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'clear-listing'
    )

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedListing,
      })
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(onWidgetColorPairPatch).toHaveBeenCalledWith({ listing: null })
    expect(onWidgetParamsPatch).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ provider: 'alpaca', listing: null }}
          onWidgetParamsPatch={onWidgetParamsPatch}
          onWidgetColorPairPatch={onWidgetColorPairPatch}
        />
      )
    })

    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
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
  })
})
