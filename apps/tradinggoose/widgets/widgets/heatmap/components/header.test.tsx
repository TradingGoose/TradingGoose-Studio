/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'

const mockUseOAuthProviderAvailability = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()
type MockTradingAccountSelectorProps = {
  onAccountSelect?: (selection: {
    serviceId?: string | null
    portfolioIdentity?: PortfolioIdentity | null
  }) => void
}
const selectedPortfolioIdentity: PortfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'credential-1',
  serviceId: 'alpaca-paper',
  accountId: 'acct-1',
}
const mockTradingAccountSelector = vi.fn(({ onAccountSelect }: MockTradingAccountSelectorProps) => (
  <button
    type='button'
    data-testid='trading-account-selector'
    onClick={() =>
      onAccountSelect?.({
        serviceId: selectedPortfolioIdentity.serviceId,
        portfolioIdentity: selectedPortfolioIdentity,
      })
    }
  >
    Trading account
  </button>
))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/widgets/utils/heatmap-params', () => ({
  emitHeatmapParamsChange: (...args: unknown[]) => mockEmitHeatmapParamsChange(...args),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/widgets/widgets/components/market-provider-settings-button', () => ({
  MarketProviderSettingsButton: () => <button type='button'>Market settings</button>,
}))

vi.mock('@/widgets/widgets/components/market-provider-selector', () => ({
  MarketProviderSelector: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (providerId: string) => void
  }) => (
    <button type='button' onClick={() => onChange?.('alpaca')}>
      Market provider {value}
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/trading-provider-selector', () => ({
  TradingProviderSelector: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: (providerId: string) => void
  }) => (
    <button
      type='button'
      data-testid='trading-provider-selector'
      onClick={() => onChange?.('alpaca')}
    >
      Trading provider {value}
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/trading-account-selector', () => ({
  TradingAccountSelector: (props: MockTradingAccountSelectorProps) =>
    mockTradingAccountSelector(props),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
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

describe('HeatmapHeaderControls', () => {
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

  it('does not normalize an invalid market provider to a default provider', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'watchlist',
          marketProvider: 'unsupported-provider',
        },
      } as any,
    })

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.center}
          {slots?.right}
        </>
      )
    })

    expect(mockEmitHeatmapParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          marketProvider: expect.any(String),
        }),
      })
    )
    expect(mockUseOAuthProviderAvailability).not.toHaveBeenCalled()
    expect(mockTradingAccountSelector).not.toHaveBeenCalled()
  })

  it('shows the account selector after a portfolio trading provider is selected', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'portfolio',
          tradingProvider: 'alpaca',
        },
      } as any,
    })

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.center}
          {slots?.right}
        </>
      )
    })

    expect(container.textContent).toContain('Trading account')
    expect(mockTradingAccountSelector).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'alpaca',
        serviceId: undefined,
        portfolioIdentity: undefined,
      })
    )
  })

  it('switches source mode from the header button group', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'watchlist',
        },
      } as any,
    })

    await act(async () => {
      root.render(<>{slots?.center}</>)
    })

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Portfolio')
        ?.click()
    })

    expect(mockEmitHeatmapParamsChange).toHaveBeenCalledWith({
      params: { sourceMode: 'portfolio' },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
  })

  it('switches watchlist tile size metric from the header button group', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'watchlist',
          watchlistSizeMetric: 'volumeUsd',
        },
      } as any,
    })

    await act(async () => {
      root.render(<>{slots?.center}</>)
    })

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Volume')
        ?.click()
    })

    expect(mockEmitHeatmapParamsChange).toHaveBeenCalledWith({
      params: { watchlistSizeMetric: 'volume' },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
  })

  it('updates the account id from account selection', async () => {
    const slots = renderHeatmapHeader?.({
      panelId: 'panel-1',
      widget: {
        key: 'heatmap',
        params: {
          sourceMode: 'portfolio',
          tradingProvider: 'alpaca',
        },
      } as any,
    })

    await act(async () => {
      root.render(<>{slots?.right}</>)
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="trading-account-selector"]')
        ?.click()
    })

    expect(mockEmitHeatmapParamsChange).toHaveBeenCalledWith({
      params: {
        serviceId: selectedPortfolioIdentity.serviceId,
        portfolioIdentity: selectedPortfolioIdentity,
      },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
  })
})
