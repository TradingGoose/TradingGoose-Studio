/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'

const mockUseOAuthProviderAvailability = vi.fn()
const mockEmitQuickOrderParamsChange = vi.fn()
type MockMarketProviderControlsProps = {
  value?: string | null
  workspaceId?: string
  providerParams?: Record<string, unknown>
  authParams?: Record<string, unknown>
  onChange?: (provider: string) => void
  onSettingsSave?: (next: {
    providerParams?: Record<string, unknown>
    auth?: Record<string, unknown>
  }) => void
}
const mockMarketProviderControls = vi.fn(
  ({
    value,
    workspaceId,
    providerParams,
    authParams,
    onChange,
    onSettingsSave,
  }: MockMarketProviderControlsProps) => (
    <div
      data-testid='market-provider-controls'
      data-provider={value ?? ''}
      data-workspace-id={workspaceId ?? ''}
      data-provider-params={JSON.stringify(providerParams ?? null)}
      data-auth-params={JSON.stringify(authParams ?? null)}
    >
      <button
        type='button'
        data-testid='market-provider-selector'
        onClick={() => onChange?.('finnhub')}
      >
        market provider
      </button>
      <button
        type='button'
        data-testid='market-provider-settings'
        onClick={() =>
          onSettingsSave?.({
            providerParams: { region: 'US' },
            auth: { apiKey: 'market-key' },
          })
        }
      >
        market settings
      </button>
    </div>
  )
)
type MockTradingAccountSelectorProps = {
  onAccountSelect?: (selection: unknown) => void
}
const mockTradingAccountSelector = vi.fn(({ onAccountSelect }: MockTradingAccountSelectorProps) => (
  <button
    type='button'
    data-testid='account-selector'
    onClick={() =>
      onAccountSelect?.({
        accountId: 'acct-1',
      })
    }
  >
    account
  </button>
))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/widgets/utils/quick-order-params', () => ({
  emitQuickOrderParamsChange: (...args: unknown[]) => mockEmitQuickOrderParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/market-provider-controls', () => ({
  MarketProviderControls: (props: MockMarketProviderControlsProps) =>
    mockMarketProviderControls(props),
}))

vi.mock('@/widgets/widgets/components/trading-provider-selector', () => ({
  TradingProviderSelector: ({ onChange }: { onChange: (provider: string) => void }) => (
    <button type='button' data-testid='provider-selector' onClick={() => onChange('tradier')}>
      provider
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
}))

const queryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

const renderHeader = (...args: Parameters<NonNullable<typeof renderQuickOrderHeader>>) => {
  if (!renderQuickOrderHeader) throw new Error('quick order header renderer missing')
  const header = renderQuickOrderHeader(...args)
  if (!header) throw new Error('quick order header output missing')
  return header
}

describe('QuickOrderHeaderControls', () => {
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
      queryResult({ data: { 'alpaca-live': true, 'alpaca-paper': true, tradier: true } })
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders provider/account controls in left slot and BUY/SELL tabs in center slot', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      context: { workspaceId: 'workspace-1' } as any,
      widget: {
        key: 'quick_order',
        params: {
          provider: 'alpaca',
          marketProvider: 'yahoo-finance',
          marketProviderParams: { region: 'US' },
          marketAuth: { apiKey: 'market-key' },
          side: 'buy',
        },
      } as any,
    })

    act(() => {
      root.render(
        <>
          {header.left}
          {header.center}
        </>
      )
    })

    expect(container.querySelector('[data-testid="market-provider-controls"]')).not.toBeNull()
    expect(
      container.querySelector<HTMLElement>('[data-testid="market-provider-controls"]')?.dataset
        .workspaceId
    ).toBe('workspace-1')
    expect(
      container.querySelector<HTMLElement>('[data-testid="market-provider-controls"]')?.dataset
        .providerParams
    ).toBe(JSON.stringify({ region: 'US' }))
    expect(
      container.querySelector<HTMLElement>('[data-testid="market-provider-controls"]')?.dataset
        .authParams
    ).toBe(JSON.stringify({ apiKey: 'market-key' }))
    expect(container.querySelector('[data-testid="provider-selector"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="account-selector"]')).not.toBeNull()
    expect(container.textContent).toContain('BUY')
    expect(container.textContent).toContain('SELL')
  })

  it('emits scoped provider resets and side changes', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(
        <>
          {header.left}
          {header.center}
        </>
      )
    })

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="market-provider-selector"]')
        ?.click()
      container.querySelector<HTMLButtonElement>('[data-testid="provider-selector"]')?.click()
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'SELL')
        ?.click()
    })

    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: {
        marketProvider: 'finnhub',
        marketProviderParams: null,
        marketAuth: null,
      },
      panelId: 'panel-1',
      widgetKey: 'quick_order',
    })
    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: {
        provider: 'tradier',
        accountId: null,
        credentialServiceId: null,
      },
      panelId: 'panel-1',
      widgetKey: 'quick_order',
    })
    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: { side: 'sell' },
      panelId: 'panel-1',
      widgetKey: 'quick_order',
    })
  })

  it('emits scoped market provider settings independently from trading account settings', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', marketProvider: 'yahoo-finance', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="market-provider-settings"]')
        ?.click()
    })

    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: {
        marketProviderParams: { region: 'US' },
        marketAuth: { apiKey: 'market-key' },
      },
      panelId: 'panel-1',
      widgetKey: 'quick_order',
    })
  })

  it('does not infer market provider settings from the trading provider', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    expect(mockMarketProviderControls).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        providerParams: undefined,
        authParams: undefined,
      })
    )
    expect(mockEmitQuickOrderParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          marketProvider: expect.any(String),
        }),
      })
    )
  })

  it('shows the account selector after a trading provider is selected', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')
    ).toBeTruthy()
  })

  it('hides account selection before a trading provider is selected', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="provider-selector"]')
    ).toBeTruthy()
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')
    ).toBeNull()
  })

  it('updates the account id from account selection', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')?.click()
    })

    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: {
        accountId: 'acct-1',
      },
      panelId: 'panel-1',
      widgetKey: 'quick_order',
    })
  })
})
