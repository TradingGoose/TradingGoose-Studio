/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'

const mockUseOAuthProviderAvailability = vi.fn()
const mockEmitHeatmapParamsChange = vi.fn()
type MockTradingAccountSelectorProps = {
  onAccountSelect?: (selection: unknown) => void
}
const mockTradingAccountSelector = vi.fn(({ onAccountSelect }: MockTradingAccountSelectorProps) => (
  <button
    type='button'
    data-testid='trading-account-selector'
    onClick={() =>
      onAccountSelect?.({
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
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

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: { children?: ReactNode; value: string }) => (
    <button type='button' data-value={value}>
      {children}
    </button>
  ),
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
          alpaca: true,
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

  it('normalizes an invalid persisted market provider from the header controls', async () => {
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

    expect(mockEmitHeatmapParamsChange).toHaveBeenCalledWith({
      params: {
        marketProvider: expect.not.stringMatching(/^unsupported-provider$/),
      },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
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
        credentialProviderId: 'alpaca',
        accountId: undefined,
      })
    )
  })

  it('updates credential, environment, and account together from account selection', async () => {
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
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
      },
      panelId: 'panel-1',
      widgetKey: 'heatmap',
    })
  })
})
