/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeatmapWidgetBody } from '@/widgets/widgets/heatmap/components/body'

const mockUseResolvedListings = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn()
const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockUseTradingHoldingsListings = vi.fn()
const mockUseWatchlists = vi.fn()
const mockHeatmapTreemapChart = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()

vi.mock('@/hooks/queries/listing-resolution', () => ({
  useResolvedListings: (...args: unknown[]) => mockUseResolvedListings(...args),
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (...args: unknown[]) => mockUseMarketQuoteSnapshots(...args),
}))

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
  useTradingHoldingsListings: (...args: unknown[]) => mockUseTradingHoldingsListings(...args),
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

const createListing = (symbol: string) => ({
  listing_id: symbol,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
})

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
    mockUseOAuthProviderAvailability.mockReturnValue(createQueryResult({ data: { alpaca: true } }))
    mockUseOAuthCredentials.mockReturnValue(createQueryResult({ data: [] }))
    mockUseTradingAccounts.mockReturnValue(createQueryResult({ data: [] }))
    mockUseTradingHoldingsListings.mockReturnValue(createQueryResult({ data: [] }))
    mockUseWatchlists.mockReturnValue(createQueryResult({ data: [] }))
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
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [{ id: 'cred-1', name: 'Broker' }],
      })
    )
    mockUseTradingAccounts.mockReturnValue(
      createQueryResult({
        data: [{ id: 'account-1', name: 'Paper' }],
      })
    )
    mockUseTradingHoldingsListings.mockReturnValue(
      createQueryResult({
        data: {
          listings: [createListing('MSFT')],
          invalidPositions: [],
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'account-1',
          }}
        />
      )
    })

    expect(mockUseTradingHoldingsListings).toHaveBeenLastCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'account-1',
    })
    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            key: 'default|MSFT||',
            sourceLabels: ['Portfolio'],
          }),
        ],
      })
    )
    expect(mockHeatmapTreemapChart.mock.calls.at(-1)?.[0]).not.toHaveProperty('sourceMode')
  })

  it('shows invalid holdings when portfolio mode has no valid listings', async () => {
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [{ id: 'cred-1', name: 'Broker' }],
      })
    )
    mockUseTradingAccounts.mockReturnValue(
      createQueryResult({
        data: [{ id: 'account-1', name: 'Paper' }],
      })
    )
    mockUseTradingHoldingsListings.mockReturnValue(
      createQueryResult({
        data: {
          listings: [],
          invalidPositions: [
            {
              base: 'UNKNOWN',
            },
          ],
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
            sourceMode: 'portfolio',
            marketProvider: 'alpaca',
            tradingProvider: 'alpaca',
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'account-1',
          }}
        />
      )
    })

    expect(container.textContent).toContain('1 holding missing normalized listing identities.')
    expect(container.textContent).toContain('No valid holdings listings found for this account.')
    expect(mockHeatmapTreemapChart).not.toHaveBeenCalled()
  })
})
