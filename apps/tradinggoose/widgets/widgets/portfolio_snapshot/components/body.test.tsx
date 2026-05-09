/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioSnapshotWidgetBody } from '@/widgets/widgets/portfolio_snapshot/components/body'

const mockUseOAuthProviderAvailability = vi.fn()
const mockUseOAuthCredentialsByProviderIds = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn()
const mockUsePortfolioIdentities = vi.fn()
const mockUsePortfolioDetail = vi.fn()
const mockUsePortfolioPerformance = vi.fn()
const mockEmitPortfolioSnapshotParamsChange = vi.fn()

const selectedPortfolioIdentity = {
  providerId: 'alpaca',
  credentialServiceId: 'alpaca-live',
  accountId: 'acct-1',
  accountName: 'Paper',
  accountType: 'paper' as const,
  baseCurrency: 'USD',
  accountStatus: 'active' as const,
}

const createListing = (symbol: string) => ({
  listing_id: `TG_LSTG_${symbol}`,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
})

const createPortfolioPosition = (
  symbol: string,
  quantity: number,
  listing = createListing(symbol)
) => ({
  symbol: {
    base: symbol,
    quote: 'USD',
    assetClass: 'stock' as const,
    active: true,
    rank: 0,
    listing,
  },
  quantity,
})

const createPortfolioDetail = ({
  positions = [createPortfolioPosition('AAPL', 10)],
  summary = {
    totalPortfolioValue: 10000,
    totalCashValue: 2500,
    totalHoldingsValue: 7500,
    buyingPower: 15000,
    totalUnrealizedPnl: 100,
  },
}: {
  positions?: Array<ReturnType<typeof createPortfolioPosition>>
  summary?: {
    totalPortfolioValue: number
    totalCashValue: number
    totalHoldingsValue?: number
    buyingPower?: number
    totalUnrealizedPnl?: number
  }
} = {}) => ({
  ...selectedPortfolioIdentity,
  environment: 'live' as const,
  asOf: '2026-04-22T15:30:00.000Z',
  cashBalances: [],
  positions,
  orders: [],
  summary,
})

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentialsByProviderIds: (...args: unknown[]) =>
    mockUseOAuthCredentialsByProviderIds(...args),
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (...args: unknown[]) => mockUseMarketQuoteSnapshots(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  usePortfolioIdentities: (...args: unknown[]) => mockUsePortfolioIdentities(...args),
  usePortfolioDetail: (...args: unknown[]) => mockUsePortfolioDetail(...args),
  usePortfolioPerformance: (...args: unknown[]) => mockUsePortfolioPerformance(...args),
}))

vi.mock('@/widgets/utils/portfolio-snapshot-params', () => ({
  emitPortfolioSnapshotParamsChange: (...args: unknown[]) =>
    mockEmitPortfolioSnapshotParamsChange(...args),
  usePortfolioSnapshotParamsPersistence: vi.fn(),
}))

vi.mock('@/widgets/widgets/portfolio_snapshot/components/performance-chart', () => ({
  PortfolioSnapshotPerformanceChart: () => <div>performance-chart</div>,
}))

const createQueryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

describe('PortfolioSnapshotWidgetBody', () => {
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

    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {
          'alpaca-live': true,
          'alpaca-paper': true,
          'tradier-live': true,
          'tradier-paper': true,
        },
      })
    )
    mockUseOAuthCredentialsByProviderIds.mockReturnValue(
      createQueryResult({
        data: {
          'alpaca-live': [{ id: 'cred-1', name: 'Alpaca Live', provider: 'alpaca-live' }],
          'tradier-live': [{ id: 'cred-2', name: 'Tradier Live', provider: 'tradier-live' }],
        },
      })
    )
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [selectedPortfolioIdentity],
      })
    )
    mockUseMarketQuoteSnapshots.mockReturnValue(
      createQueryResult({
        data: {
          'default|TG_LSTG_AAPL||': {
            lastPrice: 110,
            previousClose: 100,
            change: 10,
            changePercent: 10,
          },
        },
      })
    )
    mockUsePortfolioDetail.mockReturnValue(
      createQueryResult({
        data: createPortfolioDetail(),
      })
    )
    mockUsePortfolioPerformance.mockReturnValue(
      createQueryResult({
        data: {
          window: '1D',
          supportedWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
          series: [
            { timestamp: '2026-04-21T00:00:00.000Z', equity: 10000 },
            { timestamp: '2026-04-22T00:00:00.000Z', equity: 10100 },
          ],
          summary: {
            currency: 'USD',
            startEquity: 10000,
            endEquity: 10100,
            highEquity: 10100,
            lowEquity: 10000,
            absoluteReturn: 100,
            percentReturn: 1,
            asOf: '2026-04-22T00:00:00.000Z',
          },
        },
      })
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('auto-selects and immediately uses the single returned account when none is persisted', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: { portfolioIdentity: selectedPortfolioIdentity, credentialServiceId: 'alpaca-live' },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUsePortfolioDetail).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: 'alpaca',
      credentialServiceId: 'alpaca-live',
      portfolioIdentity: selectedPortfolioIdentity,
    })
    expect(mockUsePortfolioPerformance).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: 'alpaca',
      credentialServiceId: 'alpaca-live',
      portfolioIdentity: selectedPortfolioIdentity,
      selectedWindow: '1D',
    })
  })

  it('clears provider-scoped state when it normalizes an invalid provider', async () => {
    const params = {
      provider: 'unsupported-provider',
      portfolioIdentity: selectedPortfolioIdentity,
      selectedWindow: '1D',
    } as const

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={params}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        provider: null,
        portfolioIdentity: null,
        credentialServiceId: null,
        selectedWindow: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUsePortfolioIdentities).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: undefined,
      credentialServiceId: undefined,
      enabled: false,
    })
    expect(container.textContent).toContain('Select a trading provider to get started.')
  })

  it('falls back to the provider-supported window list', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: 'MAX',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: { selectedWindow: '1D' },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('renders performance windows from the selected trading provider', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'tradier',
            portfolioIdentity: {
              ...selectedPortfolioIdentity,
              providerId: 'tradier',
              credentialServiceId: 'tradier-live',
            },
            selectedWindow: 'MAX',
          }}
        />
      )
    })

    const windows = Array.from(container.querySelectorAll('[role="tab"]')).map((button) =>
      button.textContent?.trim()
    )

    expect(windows).toEqual(['1W', '1M', 'YTD', '1Y', 'MAX'])
    expect(windows).not.toContain('1D')
    expect(mockUsePortfolioPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'tradier',
        selectedWindow: 'MAX',
      })
    )
  })

  it('preserves a saved account when the accounts query errors', async () => {
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [],
        error: new Error('accounts fetch failed'),
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).not.toHaveBeenCalledWith({
      params: { portfolioIdentity: null },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('renders the no-accounts empty state when the broker returns zero accounts', async () => {
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [],
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: null,
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain(
      'No broker accounts found for this provider connection.'
    )
  })

  it('renders the loaded performance and summary state', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
            marketProvider: 'alpaca',
            marketAuth: { apiKey: '{{ ALPACA_API_KEY }}' },
          }}
        />
      )
    })

    expect(container.textContent).toContain('Performance')
    expect(container.textContent).toContain('Current Summary')
    expect(container.textContent).toContain('Portfolio Value')
    expect(container.textContent).toContain('Market Quotes')
    expect(container.textContent).toContain('Quote Value')
    expect(container.textContent).toContain('Day Change')
    expect(container.textContent).toContain('Day %')
    expect(container.textContent).toContain('Quoted Positions')
    expect(container.textContent).toContain('Alpaca · active · paper')
    expect(container.textContent).toContain('performance-chart')
    expect(mockUsePortfolioDetail).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      credentialServiceId: 'alpaca-live',
      portfolioIdentity: selectedPortfolioIdentity,
    })
    expect(mockUseMarketQuoteSnapshots).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [
        {
          key: 'default|TG_LSTG_AAPL||',
          listing: {
            listing_id: 'TG_LSTG_AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
      auth: { apiKey: '{{ ALPACA_API_KEY }}' },
      providerParams: undefined,
      refreshKey: null,
      enabled: true,
    })
  })

  it('does not use trading provider settings as market quote provider settings', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          marketProvider: expect.any(String),
        }),
      })
    )
    expect(mockUseMarketQuoteSnapshots).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      provider: undefined,
      items: [
        {
          key: 'default|TG_LSTG_AAPL||',
          listing: {
            listing_id: 'TG_LSTG_AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
      auth: undefined,
      providerParams: undefined,
      refreshKey: null,
      enabled: false,
    })
  })

  it('uses signed quantity for quote-backed day change', async () => {
    mockUsePortfolioDetail.mockReturnValue(
      createQueryResult({
        data: createPortfolioDetail({
          positions: [createPortfolioPosition('TSLA', -5)],
        }),
      })
    )
    mockUseMarketQuoteSnapshots.mockReturnValue(
      createQueryResult({
        data: {
          'default|TG_LSTG_TSLA||': {
            lastPrice: 110,
            previousClose: 100,
            change: 10,
            changePercent: 10,
          },
        },
      })
    )
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toContain('$550.00')
    expect(container.textContent).toContain('-$50.00')
    expect(container.textContent).toContain('-8.33%')
  })

  it('keeps broker snapshot visible when market quotes fail', async () => {
    mockUseMarketQuoteSnapshots.mockReturnValue(
      createQueryResult({
        error: new Error('quotes failed'),
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          context={{ workspaceId: 'workspace-1' }}
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
            marketProvider: 'alpaca',
          }}
        />
      )
    })

    expect(container.textContent).toContain('Performance')
    expect(container.textContent).toContain('Current Summary')
    expect(container.textContent).toContain('quotes failed')
    expect(container.textContent).toContain('Quote Value')
  })

  it('renders the explicit performance unavailable state', async () => {
    mockUsePortfolioPerformance.mockReturnValue(
      createQueryResult({
        data: {
          window: '1D',
          supportedWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
          series: [],
          summary: null,
          unavailableReason: 'No usable performance data returned by broker',
        },
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('No usable performance data returned by broker')
  })

  it('refetches snapshot and performance when runtime.refreshAt changes', async () => {
    const snapshotRefetch = vi.fn()
    const performanceRefetch = vi.fn()

    mockUsePortfolioDetail.mockReturnValue(
      createQueryResult({
        data: createPortfolioDetail({
          positions: [],
          summary: {
            totalPortfolioValue: 10000,
            totalCashValue: 2500,
          },
        }),
        refetch: snapshotRefetch,
      })
    )
    mockUsePortfolioPerformance.mockReturnValue(
      createQueryResult({
        data: {
          window: '1D',
          supportedWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
          series: [],
          summary: null,
          unavailableReason: 'No usable performance data returned by broker',
        },
        refetch: performanceRefetch,
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
          }}
        />
      )
    })

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            portfolioIdentity: selectedPortfolioIdentity,
            selectedWindow: '1D',
            runtime: {
              refreshAt: 123,
            },
          }}
        />
      )
    })

    expect(snapshotRefetch).toHaveBeenCalledTimes(1)
    expect(performanceRefetch).toHaveBeenCalledTimes(1)
  })

  it('shows the no-provider-configured state when trading providers are unavailable', async () => {
    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {},
      })
    )
    mockUsePortfolioIdentities.mockReturnValue(
      createQueryResult({
        data: [],
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('No trading providers are configured.')
    expect(mockUsePortfolioIdentities).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: undefined,
      credentialServiceId: undefined,
      enabled: false,
    })
    expect(mockUsePortfolioDetail).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: undefined,
      credentialServiceId: undefined,
      portfolioIdentity: undefined,
    })
  })

  it('requires selecting a provider before loading credentials or accounts', async () => {
    mockUsePortfolioIdentities.mockReturnValueOnce(createQueryResult({ data: [] }))

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{}}
        />
      )
    })

    expect(container.textContent).toContain('Select a trading provider to get started.')
    expect(mockUsePortfolioIdentities).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: undefined,
      credentialServiceId: undefined,
      enabled: false,
    })
    expect(mockUsePortfolioDetail).toHaveBeenCalledWith({
      workspaceId: undefined,
      provider: undefined,
      credentialServiceId: undefined,
      portfolioIdentity: undefined,
    })
  })
})
