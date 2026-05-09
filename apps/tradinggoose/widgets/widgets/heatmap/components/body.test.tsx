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
const mockUseOAuthCredentialsByProviderIds = vi.fn()
const mockUsePortfolioIdentities = vi.fn()
const mockUsePortfolioDetail = vi.fn()
const mockUseWatchlists = vi.fn()
const mockHeatmapTreemapChart = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialServiceId: 'alpaca-live',
  accountId: 'account-1',
  providerName: null,
  accountName: 'Paper',
  accountType: null,
  baseCurrency: 'USD',
  accountStatus: null,
}

const createPortfolioPosition = (listing: ReturnType<typeof createListing>, quantity: number) => ({
  symbol: {
    base: listing.listing_id,
    quote: 'USD',
    assetClass: 'stock' as const,
    active: true,
    rank: 0,
    listing,
  },
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
      return {
        ...createPortfolioPosition(listing, quantity),
        symbol: {
          ...createPortfolioPosition(listing, quantity).symbol,
          base: symbol,
        },
      }
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

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentialsByProviderIds: (...args: unknown[]) =>
    mockUseOAuthCredentialsByProviderIds(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  usePortfolioIdentities: (...args: unknown[]) => mockUsePortfolioIdentities(...args),
  usePortfolioDetail: (...args: unknown[]) => mockUsePortfolioDetail(...args),
}))

vi.mock('@/hooks/queries/watchlists', () => ({
  useWatchlists: (...args: unknown[]) => mockUseWatchlists(...args),
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
    mockUseOAuthCredentialsByProviderIds.mockReturnValue(
      createQueryResult({
        data: {
          'alpaca-live': [{ id: 'cred-1', name: 'Alpaca Live', provider: 'alpaca-live' }],
        },
      })
    )
    mockUsePortfolioIdentities.mockReturnValue(createQueryResult({ data: [] }))
    mockUsePortfolioDetail.mockReturnValue(createQueryResult({ data: undefined }))
    mockUseWatchlists.mockReturnValue(createQueryResult({ data: [] }))
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
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            name: 'Watchlist',
            isSystem: false,
            items: watchlistItems,
            settings: { showLogo: true, showTicker: true, showDescription: true },
            createdAt: '',
            updatedAt: '',
          },
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
    expect(mockUseWatchlists).toHaveBeenCalledWith('workspace-1')
    expect(mockUseOAuthProviderAvailability).toHaveBeenCalledWith(expect.any(Array), false)
  })

  it('does not render stale placeholder watchlist data into the shared chart pipeline', async () => {
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'old-workspace',
            userId: 'user-1',
            name: 'Old Watchlist',
            isSystem: false,
            items: [
              {
                id: 'old-item',
                type: 'listing' as const,
                listing: createListing('OLD'),
              },
            ],
            settings: { showLogo: true, showTicker: true, showDescription: true },
            createdAt: '',
            updatedAt: '',
          },
        ],
        isPlaceholderData: true,
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

    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([])
    expect(mockUseResolvedListings.mock.calls.at(-1)?.[0].listings).toEqual([])
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
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
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            name: 'Watchlist',
            isSystem: false,
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
        ],
      })
    )
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
      credentialServiceId: 'alpaca-live',
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
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            name: 'Watchlist',
            isSystem: false,
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
        ],
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
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            name: 'Watchlist',
            isSystem: false,
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
        ],
      })
    )

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
    mockUseWatchlists.mockReturnValue(
      createQueryResult({
        data: [
          {
            id: 'watchlist-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            name: 'Watchlist',
            isSystem: false,
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
        ],
      })
    )

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
