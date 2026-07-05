/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingIdentity } from '@/lib/listing/identity'
import { usePairColorStore } from '@/stores/dashboard/pair-store'
import { PAIR_COLORS } from '@/widgets/pair-colors'
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
  name: 'Growth',
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

vi.mock('@/lib/yjs/use-entity-fields', () => ({
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
      setName: vi.fn(),
      setSettings: vi.fn(),
      setItems: mockSetWatchlistItems,
      save: mockSaveWatchlistDocument,
      isLoading: false,
      error: null,
    }
  },
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (request: unknown) => mockUseMarketQuoteSnapshots(request),
}))

vi.mock('@/widgets/utils/watchlist-params', () => ({
  emitWatchlistParamsChange: vi.fn(),
  useWatchlistParamsPersistence: vi.fn(),
}))

vi.mock('@/widgets/widgets/watchlist/components/watchlist-table', () => ({
  WatchlistTable: (props: {
    selectedListing?: ListingIdentity | null
    isLinkedSelection?: boolean
    onSelectListing?: (listing: ListingIdentity | null) => void
    onRemoveSection?: (sectionId: string) => void
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
        <button type='button' onClick={() => props.onRemoveSection?.('section-1')}>
          remove-section
        </button>
      </>
    )
  },
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

describe('WatchlistWidgetBody', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveWatchlistDocument.mockResolvedValue(undefined)
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    resetPairStore()
    currentWatchlists = [watchlist]
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

  it('writes selected listings into pairStore when the widget is linked', async () => {
    usePairColorStore.getState().setContext('red', { watchlistId: 'watchlist-1' })

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ watchlistId: 'watchlist-1', provider: 'alpaca' }}
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

    expect(usePairColorStore.getState().contexts.red.listing).toEqual(selectedListing)
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing,
      })
    )
  })

  it('keeps pairStore untouched when the widget is unlinked', async () => {
    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='gray'
          widget={{ key: 'watchlist', pairColor: 'gray' } as any}
          params={{ watchlistId: 'watchlist-1', provider: 'alpaca' }}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === 'select-listing'
    )

    await act(async () => {
      button?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    })

    expect(usePairColorStore.getState().contexts.gray.listing).toBeUndefined()
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: false,
        selectedListing: null,
      })
    )
  })

  it('does not auto-claim the first watchlist when the widget is linked without a pair watchlist', async () => {
    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ watchlistId: 'watchlist-1', provider: 'alpaca' }}
        />
      )
    })

    expect(usePairColorStore.getState().contexts.red.watchlistId).toBeUndefined()
    expect(mockWatchlistTable).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Select a watchlist.')
  })

  it('clears linked selections from pairStore when the widget deselects the current item', async () => {
    usePairColorStore.setState((state) => ({
      contexts: {
        ...state.contexts,
        red: {
          ...state.contexts.red,
          watchlistId: 'watchlist-1',
          listing: selectedListing,
        },
      },
    }))

    await act(async () => {
      root.render(
        <WatchlistWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          panelId='panel-1'
          pairColor='red'
          widget={{ key: 'watchlist', pairColor: 'red' } as any}
          params={{ watchlistId: 'watchlist-1', provider: 'alpaca' }}
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

    expect(usePairColorStore.getState().contexts.red.listing).toBeUndefined()
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
            watchlistId: 'watchlist-1',
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
            watchlistId: 'watchlist-1',
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
            watchlistId: 'watchlist-1',
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

  it('removes a section block from the Yjs item document when deleting a section', async () => {
    currentWatchlists = [
      {
        ...watchlist,
        items: [
          {
            id: 'root-listing',
            type: 'listing' as const,
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
            label: 'Tech',
          },
          {
            id: 'section-listing',
            type: 'listing' as const,
            listing: selectedListing,
          },
          {
            id: 'section-2',
            type: 'section' as const,
            label: 'Energy',
          },
          {
            id: 'next-section-listing',
            type: 'listing' as const,
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
          params={{ watchlistId: 'watchlist-1', provider: 'alpaca' }}
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
        listing: {
          listing_id: 'MSFT',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'section-2',
        type: 'section',
        label: 'Energy',
      },
      {
        id: 'next-section-listing',
        type: 'listing',
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
