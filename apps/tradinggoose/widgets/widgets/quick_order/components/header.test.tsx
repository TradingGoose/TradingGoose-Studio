/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'
import { getQuickOrderSubmitMutationKey } from '@/widgets/widgets/quick_order/components/shared'

const mockUseOAuthProviderAvailability = vi.fn()
const mockPatchWidgetParams = vi.fn()
let queryClient: QueryClient
type MockMarketProviderControlsProps = {
  value?: string | null
  workspaceId?: string
  providerParams?: Record<string, unknown>
  authParams?: Record<string, unknown>
  disabled?: boolean
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
    disabled,
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
        disabled={disabled}
        onClick={() => onChange?.('finnhub')}
      >
        market provider
      </button>
      <button
        type='button'
        data-testid='market-provider-settings'
        disabled={disabled}
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
  disabled?: boolean
  onAccountSelect?: (selection: unknown) => void
}
const mockTradingAccountSelector = vi.fn(
  ({ disabled, onAccountSelect }: MockTradingAccountSelectorProps) => (
    <button
      type='button'
      data-testid='account-selector'
      disabled={disabled}
      onClick={() =>
        onAccountSelect?.({
          portfolioIdentity: {
            providerId: 'alpaca',
            credentialId: 'oauth-account-1',
            serviceId: 'alpaca-live',
            accountId: 'acct-1',
          },
        })
      }
    >
      account
    </button>
  )
)
const mockTradingProviderSelector = vi.fn(
  ({ disabled, onChange }: { disabled?: boolean; onChange: (provider: string) => void }) => (
    <button
      type='button'
      data-testid='provider-selector'
      disabled={disabled}
      onClick={() => onChange('tradier')}
    >
      provider
    </button>
  )
)

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: (...args: unknown[]) => mockPatchWidgetParams(...args),
  }),
}))

vi.mock('@/components/market-selector/provider-controls', () => ({
  MarketProviderControls: (props: MockMarketProviderControlsProps) =>
    mockMarketProviderControls(props),
}))

vi.mock('@/components/trading-selector/provider-selector', () => ({
  TradingProviderSelector: (props: { disabled?: boolean; onChange: (provider: string) => void }) =>
    mockTradingProviderSelector(props),
}))

vi.mock('@/components/trading-selector/account-selector', () => ({
  TradingAccountSelector: (props: MockTradingAccountSelectorProps) =>
    mockTradingAccountSelector(props),
}))

vi.mock('@/components/widget-header-control', () => ({
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
  return {
    ...header,
    left: <QueryClientProvider client={queryClient}>{header.left}</QueryClientProvider>,
    center: <QueryClientProvider client={queryClient}>{header.center}</QueryClientProvider>,
  }
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
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })

    mockUseOAuthProviderAvailability.mockReturnValue(
      queryResult({
        data: {
          'alpaca-live': true,
          'alpaca-paper': true,
          'tradier-live': true,
        },
      })
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
  })

  const mountHeader = (
    params: Record<string, unknown>,
    options: { includeCenter?: boolean; workspaceId?: string } = {}
  ) => {
    const header = renderHeader({
      channelId: 'quick-order-panel-1',
      panelId: 'panel-1',
      context: options.workspaceId ? ({ workspaceId: options.workspaceId } as any) : undefined,
      widget: { key: 'quick_order', params } as any,
    })
    act(() => {
      root.render(
        <>
          {header.left}
          {options.includeCenter ? header.center : null}
        </>
      )
    })
    return header
  }

  it('renders provider/account controls in left slot and BUY/SELL tabs in center slot', () => {
    mountHeader(
      {
        provider: 'alpaca',
        marketProvider: 'yahoo-finance',
        marketProviderParams: { region: 'US' },
        marketAuth: { apiKey: 'market-key' },
        side: 'buy',
      },
      { includeCenter: true, workspaceId: 'workspace-1' }
    )

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
    mountHeader({ provider: 'alpaca', side: 'buy' }, { includeCenter: true })

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="market-provider-selector"]')
        ?.click()
      container.querySelector<HTMLButtonElement>('[data-testid="provider-selector"]')?.click()
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'SELL')
        ?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      marketProvider: 'finnhub',
      marketProviderParams: null,
      marketAuth: null,
    })
    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      provider: 'tradier',
      portfolioIdentity: null,
      serviceId: null,
    })
    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      side: 'sell',
    })
  })

  it('emits scoped market provider settings independently from trading account settings', () => {
    mountHeader({ provider: 'alpaca', marketProvider: 'yahoo-finance', side: 'buy' })

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="market-provider-settings"]')
        ?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      marketProviderParams: { region: 'US' },
      marketAuth: { apiKey: 'market-key' },
    })
  })

  it('does not infer market provider settings from the trading provider', () => {
    mountHeader({ provider: 'alpaca', side: 'buy' })

    expect(mockMarketProviderControls).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        providerParams: undefined,
        authParams: undefined,
      })
    )
    expect(mockPatchWidgetParams).not.toHaveBeenCalledWith(
      expect.objectContaining({
        marketProvider: expect.any(String),
      })
    )
  })

  it('shows the account selector after a trading provider is selected', () => {
    mountHeader({ provider: 'alpaca', side: 'buy' })

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')
    ).toBeTruthy()
  })

  it('hides account selection before a trading provider is selected', () => {
    mountHeader({ side: 'buy' })

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="provider-selector"]')
    ).toBeTruthy()
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')
    ).toBeNull()
  })

  it('updates the account id from account selection', () => {
    mountHeader({ provider: 'alpaca', side: 'buy' })

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')?.click()
    })

    expect(mockPatchWidgetParams).toHaveBeenCalledWith({
      portfolioIdentity: {
        providerId: 'alpaca',
        credentialId: 'oauth-account-1',
        serviceId: 'alpaca-live',
        accountId: 'acct-1',
      },
    })
  })

  it('locks every panel header control while its order mutation converges', async () => {
    let resolveMutation!: () => void
    const mutationRequest = new Promise<void>((resolve) => {
      resolveMutation = resolve
    })
    mountHeader(
      { provider: 'alpaca', marketProvider: 'yahoo-finance', side: 'buy' },
      { includeCenter: true, workspaceId: 'workspace-1' }
    )

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: getQuickOrderSubmitMutationKey('panel-1'),
      mutationFn: () => mutationRequest,
    })
    let mutationPromise!: Promise<void>
    await act(async () => {
      mutationPromise = mutation.execute(undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    for (const id of [
      'market-provider-selector',
      'market-provider-settings',
      'provider-selector',
      'account-selector',
    ]) {
      expect(container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)).toBeDisabled()
    }
    const sideButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === 'BUY' || button.textContent === 'SELL'
    )
    expect(sideButtons).toHaveLength(2)
    sideButtons.forEach((button) => expect(button).toBeDisabled())

    mockPatchWidgetParams.mockClear()
    mockMarketProviderControls.mock.calls.at(-1)?.[0].onChange?.('finnhub')
    mockMarketProviderControls.mock.calls.at(-1)?.[0].onSettingsSave?.({
      providerParams: { region: 'US' },
    })
    mockTradingProviderSelector.mock.calls.at(-1)?.[0].onChange('tradier')
    mockTradingAccountSelector.mock.calls.at(-1)?.[0].onAccountSelect?.({
      portfolioIdentity: { accountId: 'acct-2' },
    })
    expect(mockPatchWidgetParams).not.toHaveBeenCalled()

    await act(async () => {
      resolveMutation()
      await mutationPromise
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelectorAll('button:disabled')).toHaveLength(0)
  })
})
