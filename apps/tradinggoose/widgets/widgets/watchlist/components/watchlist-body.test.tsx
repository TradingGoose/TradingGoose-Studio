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

const selectedListing: ListingIdentity = {
  listing_id: 'BTC',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}

const watchlist = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Default',
  isSystem: true,
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

vi.mock('@/hooks/queries/watchlists', () => ({
  useWatchlists: () => ({
    data: [watchlist],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useReorderWatchlistItems: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateWatchlistItemListing: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRemoveWatchlistItem: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRenameWatchlistSection: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRemoveWatchlistSection: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/hooks/queries/watchlist-quotes', () => ({
  useWatchlistQuotes: () => ({
    data: {},
    refetch: mockRefetchQuotes,
  }),
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    resetPairStore()
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
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(usePairColorStore.getState().contexts.gray.listing).toBeUndefined()
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: false,
        selectedListing: null,
      })
    )
  })

  it('clears linked selections from pairStore when the widget deselects the current item', async () => {
    usePairColorStore.setState((state) => ({
      contexts: {
        ...state.contexts,
        red: {
          ...state.contexts.red,
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
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(usePairColorStore.getState().contexts.red.listing).toBeNull()
    expect(mockWatchlistTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLinkedSelection: true,
        selectedListing: null,
      })
    )
  })
})
