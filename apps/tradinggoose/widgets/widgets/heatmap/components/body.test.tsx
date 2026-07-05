/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import { HeatmapWidgetBody } from '@/widgets/widgets/heatmap/components/body'

const mockUseResolvedListings = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseOAuthConnections = vi.fn()
const mockUsePortfolioIdentities = vi.fn()
const mockUsePortfolioDetail = vi.fn()
const mockHeatmapTreemapChart = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()
let currentWatchlists: Array<{
  id: string
  workspaceId: string
  name: string
  items: Array<{ id: string; type: 'listing'; listing: ReturnType<typeof createListing> }>
  settings: { showLogo: boolean; showTicker: boolean; showDescription: boolean }
  createdAt: string
  updatedAt: string
}> = []
let loadingWatchlistDocumentIds = new Set<string>()
let erroredWatchlistDocuments = new Map<string, string>()

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-account-1',
  serviceId: 'alpaca-live',
  accountId: 'account-1',
  accountName: 'Paper',
  baseCurrency: 'USD',
}

const createPortfolioPosition = (listing: ReturnType<typeof createListing>, quantity: number) => ({
  listingIdentity: listing,
  quantity,
})

const createPortfolioDetail = (
  positions: Array<ReturnType<typeof createPortfolioPosition>> = []
) => ({
  ...portfolioIdentity,
  environment: 'live' as const,
  asOf: '2026-04-22T15:30:00.000Z',
  cashBalances: [],
  positions,
  orders: [],
  summary: {
    totalPortfolioValue: 0,
    totalCashValue: 0,
  },
})

const createListing = (symbol: string) => ({
  listing_id: symbol,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
})

const createPortfolioListing = (symbol: string) => ({
  listing_id: `TG_LSTG_${symbol}`,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
})

const createPortfolioDetailFromQuantities = (
  quantities: Array<{ symbol: string; quantity: number }>
) =>
  createPortfolioDetail(
    quantities.map(({ symbol, quantity }) => {
      const listing = createPortfolioListing(symbol)
      return createPortfolioPosition(listing, quantity)
    })
  )

vi.mock('@/hooks/queries/listing-resolution', () => ({
  useResolvedListings: (...args: unknown[]) => mockUseResolvedListings(...args),
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (...args: unknown[]) => mockUseMarketQuoteSnapshots(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/oauth-connections', () => ({
  useOAuthConnections: (...args: unknown[]) => mockUseOAuthConnections(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  usePortfolioIdentities: (...args: unknown[]) => mockUsePortfolioIdentities(...args),
  usePortfolioDetail: (...args: unknown[]) => mockUsePortfolioDetail(...args),
}))

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
    const isLoading = watchlistId ? loadingWatchlistDocumentIds.has(watchlistId) : false
    const error = watchlistId ? (erroredWatchlistDocuments.get(watchlistId) ?? null) : null
    return {
      record: isLoading || error ? null : record,
      name: record?.name ?? '',
      settings: record?.settings ?? { showLogo: true, showTicker: true, showDescription: true },
      items: record?.items ?? [],
      setName: vi.fn(),
      setSettings: vi.fn(),
      setItems: vi.fn(),
      save: vi.fn(),
      isLoading,
      error,
    }
  },
}))

vi.mock('@/widgets/utils/heatmap-params', () => ({
  emitHeatmapParamsChange: (...args: unknown[]) => mockEmitHeatmapParamsChange(...args),
  useHeatmapParamsPersistence: vi.fn(),
}))

vi.mock('@/widgets/widgets/heatmap/components/heatmap-treemap-chart', () => ({
  HeatmapTreemapChart: (props: { items: unknown[]; cappedCount?: number; totalCount?: number }) => {
    mockHeatmapTreemapChart(props)
    return (
      <div>
        heatmap-chart:{props.items.length}
        {props.cappedCount
          ? ` Showing first ${props.items.length} of ${props.totalCount} listings.`
          : ''}
      </div>
    )
  },
}))

const createQueryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

function resetPairContexts() {
  usePairColorStore.setState({
    contexts: Object.fromEntries(PAIR_COLORS.map((color) => [color, {}])) as Record<
      PairColor,
      PairColorContext
    >,
  })
}

describe('HeatmapWidgetBody', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseResolvedListings.mockReturnValue(createQueryResult({ data: {} }))
    mockUseMarketQuoteSnapshots.mockReturnValue(createQueryResult({ data: {} }))
    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({ data: { 'alpaca-live': true, 'alpaca-paper': true } })
    )
    mockUseOAuthConnections.mockReturnValue(
      createQueryResult({
        data: [{ providerId: 'alpaca-live', isConnected: true }],
      })
    )
    mockUsePortfolioIdentities.mockReturnValue(createQueryResult({ data: [] }))
    mockUsePortfolioDetail.mockReturnValue(createQueryResult({ data: undefined }))
    currentWatchlists = []
    loadingWatchlistDocumentIds = new Set()
    erroredWatchlistDocuments = new Map()
    resetPairContexts()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('caps watchlist-mode identities before the shared quote and chart pipeline', async () => {
    const watchlistItems = Array.from({ length: 201 }, (_, index) => ({
      id: `item-${index}`,
      type: 'listing' as const,
      listing: createListing(`SYM${index}`),
    }))
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: watchlistItems,
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toContain('Showing first 200 of 201 listings.')
    expect(container.textContent).toContain('heatmap-chart:200')
    expect(mockUseMarketQuoteSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        provider: 'alpaca',
        enabled: true,
        refreshKey: null,
        items: expect.arrayContaining([
          {
            key: 'default|SYM0||',
            listing: createListing('SYM0'),
          },
        ]),
      })
    )
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toHaveLength(200)
    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0].items).toHaveLength(200)
    expect(mockUseOAuthProviderAvailability).toHaveBeenCalledWith(expect.any(Array), false)
  })

  it('does not render watchlist chart data while the Yjs entity list is empty', async () => {
    currentWatchlists = []

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(mockUseResolvedListings.mock.calls.at(-1)?.[0].listings).toEqual([])
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })

  it('waits for watchlist Yjs documents before rendering the watchlist empty state', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]
    loadingWatchlistDocumentIds.add('watchlist-1')

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.textContent).not.toContain('No watchlist listings found.')
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })

  it('does not render partial watchlist data while one Yjs document is still loading', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-loaded',
        workspaceId: 'workspace-1',
        name: 'Loaded',
        items: [
          {
            id: 'loaded-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'watchlist-loading',
        workspaceId: 'workspace-1',
        name: 'Loading',
        items: [
          {
            id: 'loading-item',
            type: 'listing' as const,
            listing: createListing('MSFT'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]
    loadingWatchlistDocumentIds.add('watchlist-loading')

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.querySelector('svg')).toBeTruthy()
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(mockUseResolvedListings.mock.calls.at(-1)?.[0].listings).toEqual([])
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })

  it('surfaces watchlist Yjs document subscription errors', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]
    erroredWatchlistDocuments.set('watchlist-1', 'watchlist document failed')

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toContain('watchlist document failed')
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })

  it('does not reuse stale watchlist chart data when a loaded document returns to loading or error', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(mockHeatmapTreemapChart).toHaveBeenCalled()
    mockHeatmapTreemapChart.mockClear()

    loadingWatchlistDocumentIds.add('watchlist-1')
    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.querySelector('svg')).toBeTruthy()
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(container.textContent).not.toContain('heatmap-chart')

    loadingWatchlistDocumentIds.delete('watchlist-1')
    erroredWatchlistDocuments.set('watchlist-1', 'watchlist document failed again')
    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toContain('watchlist document failed again')
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(container.textContent).not.toContain('heatmap-chart')
  })

  it('does not use portfolio trading provider settings as market quote provider settings', async () => {
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [portfolioIdentity],
      })
    )
    mockUsePortfolioDetail.mockReturnValue(
      createQueryResult({
        data: createPortfolioDetailFromQuantities([{ symbol: 'MSFT', quantity: 4 }]),
      })
    )

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'portfolio',
            tradingProvider: 'alpaca',
            portfolioIdentity,
          }}
        />
      )
    })

    expect(mockUseMarketQuoteSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        provider: undefined,
        auth: undefined,
        providerParams: undefined,
        enabled: false,
      })
    )
  })

  it('switches source modes through the same source-neutral chart props', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [portfolioIdentity],
      })
    )
    mockUsePortfolioDetail.mockReturnValue(
      createQueryResult({
        data: createPortfolioDetailFromQuantities([{ symbol: 'MSFT', quantity: 4 }]),
      })
    )
    mockUseMarketQuoteSnapshots.mockReturnValue(
      createQueryResult({
        data: {
          'default|AAPL||': {
            lastPrice: 110,
            previousClose: 100,
            change: 10,
            changePercent: 10,
            volume: 20,
            volumeUsd: 2200,
          },
          'default|TG_LSTG_MSFT||': {
            lastPrice: 25,
            previousClose: 20,
            change: 5,
            changePercent: 25,
          },
        },
      })
    )

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            key: 'default|AAPL||',
            sourceLabels: ['Watchlist'],
            sizeValue: 2200,
          }),
        ],
      })
    )

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'portfolio',
            marketProvider: 'alpaca',
            tradingProvider: 'alpaca',
            portfolioIdentity,
          }}
        />
      )
    })

    expect(mockUsePortfolioDetail).toHaveBeenLastCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      enabled: true,
    })
    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            key: 'default|TG_LSTG_MSFT||',
            sourceLabels: ['Portfolio'],
            sizeValue: 100,
          }),
        ],
      })
    )
    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).not.toHaveProperty('sourceMode')
  })

  it('uses raw volume for watchlist tile size when selected', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]
    mockUseMarketQuoteSnapshots.mockReturnValue(
      createQueryResult({
        data: {
          'default|AAPL||': {
            lastPrice: 110,
            previousClose: 100,
            change: 10,
            changePercent: 10,
            volume: 20,
            volumeUsd: 2200,
          },
        },
      })
    )

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'watchlist',
            watchlistSizeMetric: 'volume',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            key: 'default|AAPL||',
            sizeValue: 20,
          }),
        ],
      })
    )
  })

  it('writes selected heatmap listings to the linked pair color context', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          pairColor='blue'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    const onListingSelect = mockHeatmapTreemapChart.mock.calls.at(-1)?.[0].onListingSelect
    expect(onListingSelect).toEqual(expect.any(Function))

    await act(async () => {
      onListingSelect(createListing('AAPL'))
    })

    expect(usePairColorStore.getState().contexts.blue.listing).toEqual(createListing('AAPL'))
    expect(usePairColorStore.getState().contexts.gray.listing).toBeUndefined()
  })

  it('does not rerender heatmap data when linked pair color context changes elsewhere', async () => {
    currentWatchlists = [
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Watchlist',
        items: [
          {
            id: 'watchlist-item',
            type: 'listing' as const,
            listing: createListing('AAPL'),
          },
        ],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: '',
        updatedAt: '',
      },
    ]

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          pairColor='blue'
          params={{
            sourceMode: 'watchlist',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    const chartRenderCount = mockHeatmapTreemapChart.mock.calls.length
    const quoteRequestCount = mockUseMarketQuoteSnapshots.mock.calls.length

    await act(async () => {
      usePairColorStore.getState().setContext('blue', { listing: createListing('MSFT') })
    })

    expect(mockHeatmapTreemapChart).toHaveBeenCalledTimes(chartRenderCount)
    expect(mockUseMarketQuoteSnapshots).toHaveBeenCalledTimes(quoteRequestCount)
  })

  it('shows empty portfolio message when portfolio mode has no listings', async () => {
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [portfolioIdentity],
      })
    )
    mockUsePortfolioDetail.mockReturnValue(createQueryResult({ data: createPortfolioDetail() }))

    await act(async () => {
      root.render(
        <HeatmapWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'heatmap' } as any}
          panelId='panel-1'
          params={{
            sourceMode: 'portfolio',
            marketProvider: 'alpaca',
            tradingProvider: 'alpaca',
            portfolioIdentity,
          }}
        />
      )
    })

    expect(container.textContent).toContain('No holdings listings found for this account.')
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })
})
