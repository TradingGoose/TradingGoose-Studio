/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioSnapshotWidgetBody } from '@/widgets/widgets/portfolio_snapshot/components/body'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockUseTradingPortfolioSnapshot = vi.fn()
const mockUseTradingPortfolioPerformance = vi.fn()
const mockEmitPortfolioSnapshotParamsChange = vi.fn()

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
  useTradingPortfolioSnapshot: (...args: unknown[]) => mockUseTradingPortfolioSnapshot(...args),
  useTradingPortfolioPerformance: (...args: unknown[]) =>
    mockUseTradingPortfolioPerformance(...args),
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
          alpaca: true,
          tradier: true,
        },
      })
    )
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [{ id: 'cred-1', name: 'Primary Broker', provider: 'alpaca' }],
      })
    )
    mockUseTradingAccounts.mockReturnValue(
      createQueryResult({
        data: [{ id: 'acct-1', name: 'Paper', type: 'paper', baseCurrency: 'USD' }],
      })
    )
    mockUseTradingPortfolioSnapshot.mockReturnValue(
      createQueryResult({
        data: {
          asOf: '2026-04-22T15:30:00.000Z',
          provider: { name: 'Alpaca', environment: 'paper' },
          account: {
            id: 'acct-1',
            name: 'Paper',
            type: 'paper',
            baseCurrency: 'USD',
            status: 'active',
          },
          cashBalances: [],
          positions: [
            {
              symbol: { base: 'AAPL', quote: 'USD', assetClass: 'stock', active: true, rank: 0 },
              quantity: 10,
            },
          ],
          orders: [],
          accountSummary: {
            totalPortfolioValue: 10000,
            totalCashValue: 2500,
            totalHoldingsValue: 7500,
            buyingPower: 15000,
            totalUnrealizedPnl: 100,
          },
        },
      })
    )
    mockUseTradingPortfolioPerformance.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: { accountId: 'acct-1' },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUseTradingPortfolioSnapshot).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
    })
    expect(mockUseTradingPortfolioPerformance).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      selectedWindow: '1D',
    })
  })

  it('clears provider-scoped state when it normalizes an invalid provider', async () => {
    const params = {
      provider: 'unsupported-provider',
      credentialId: 'cred-stale',
      accountId: 'acct-stale',
      environment: 'paper',
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
        environment: null,
        credentialId: null,
        accountId: null,
        selectedWindow: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
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

  it('renders the no-credential empty state', async () => {
    mockUseOAuthCredentials.mockReturnValue(createQueryResult({ data: [] }))

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('Connect Alpaca in provider settings to get started.')
  })

  it('preserves a saved credential when the credential query errors', async () => {
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [],
        error: new Error('credential fetch failed'),
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            credentialId: 'cred-1',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).not.toHaveBeenCalledWith({
      params: {
        credentialId: null,
        accountId: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
    })
    expect(mockUseTradingPortfolioSnapshot).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
    })
    expect(container.textContent).toContain('Performance')
  })

  it('clears a saved credential that no longer exists before querying broker accounts', async () => {
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [{ id: 'cred-2', name: 'Replacement Broker', provider: 'alpaca' }],
      })
    )

    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            credentialId: 'cred-1',
            accountId: 'acct-1',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        credentialId: null,
        accountId: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: undefined,
      environment: 'paper',
    })
    expect(container.textContent).toContain(
      'Select an Alpaca connection in provider settings to view an account snapshot.'
    )
  })

  it('preserves a saved account when the accounts query errors', async () => {
    mockUseTradingAccounts.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(mockEmitPortfolioSnapshotParamsChange).not.toHaveBeenCalledWith({
      params: { accountId: null },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('renders the no-accounts empty state when the broker returns zero accounts', async () => {
    mockUseTradingAccounts.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('No broker accounts found for the selected credential.')
  })

  it('renders the loaded performance and summary state', async () => {
    await act(async () => {
      root.render(
        <PortfolioSnapshotWidgetBody
          widget={{ key: 'portfolio_snapshot' } as any}
          panelId='panel-1'
          params={{
            provider: 'alpaca',
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('Performance')
    expect(container.textContent).toContain('Current Summary')
    expect(container.textContent).toContain('Portfolio Value')
    expect(container.textContent).toContain('Alpaca · paper · active · paper')
    expect(container.textContent).toContain('performance-chart')
  })

  it('renders the explicit performance unavailable state', async () => {
    mockUseTradingPortfolioPerformance.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
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

    mockUseTradingPortfolioSnapshot.mockReturnValue(
      createQueryResult({
        data: {
          asOf: '2026-04-22T15:30:00.000Z',
          account: { id: 'acct-1', name: 'Paper', type: 'paper', baseCurrency: 'USD' },
          cashBalances: [],
          positions: [],
          orders: [],
          accountSummary: {
            totalPortfolioValue: 10000,
            totalCashValue: 2500,
          },
        },
        refetch: snapshotRefetch,
      })
    )
    mockUseTradingPortfolioPerformance.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
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
            credentialId: 'cred-1',
            environment: 'paper',
            accountId: 'acct-1',
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
    mockUseTradingAccounts.mockReturnValue(
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
            credentialId: 'cred-1',
            environment: 'paper',
            selectedWindow: '1D',
          }}
        />
      )
    })

    expect(container.textContent).toContain('No trading providers are configured.')
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
    })
    expect(mockUseTradingPortfolioSnapshot).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
      accountId: undefined,
    })
  })

  it('requires selecting a provider before loading credentials or accounts', async () => {
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
    expect(mockUseOAuthCredentials).toHaveBeenCalledWith(undefined, false)
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
    })
    expect(mockUseTradingPortfolioSnapshot).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
      accountId: undefined,
    })
  })
})
