/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPortfolioSnapshotHeader } from '@/widgets/widgets/portfolio_snapshot/components/header'

const mockUseOAuthProviderAvailability = vi.fn()
const mockEmitPortfolioSnapshotParamsChange = vi.fn()
type MockTradingAccountSelectorProps = {
  onAccountSelect?: (selection: unknown) => void
}
const mockTradingAccountSelector = vi.fn(({ onAccountSelect }: MockTradingAccountSelectorProps) => (
  <button
    type='button'
    data-testid='account-selector'
    aria-label='Select trading account'
    onClick={() =>
      onAccountSelect?.({
        portfolioIdentity: {
          providerId: 'alpaca',
          credentialId: 'credential-1',
          credentialServiceId: 'alpaca-live',
          accountId: 'acct-1',
        },
      })
    }
  >
    account
  </button>
))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/widgets/utils/portfolio-snapshot-params', () => ({
  emitPortfolioSnapshotParamsChange: (...args: unknown[]) =>
    mockEmitPortfolioSnapshotParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
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
    <button
      type='button'
      data-testid='market-provider-selector'
      onClick={() => onChange?.('alpaca')}
    >
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
      onClick={() => onChange?.('tradier')}
    >
      Trading provider {value}
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/trading-account-selector', () => ({
  TradingAccountSelector: (props: MockTradingAccountSelectorProps) =>
    mockTradingAccountSelector(props),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
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

describe('PortfolioSnapshotHeaderControls', () => {
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

  const renderHeader = async (
    params: Record<string, unknown> | null = {
      provider: 'alpaca',
      portfolioIdentity: {
        providerId: 'alpaca',
        credentialId: 'credential-1',
        credentialServiceId: 'alpaca-live',
        accountId: 'acct-1',
      },
      selectedWindow: '1D',
    }
  ) => {
    const slots = renderPortfolioSnapshotHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'portfolio_snapshot',
        params,
      } as any,
    })

    expect(slots).toBeTruthy()

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.center}
          {slots?.right}
        </>
      )
    })
  }

  it('does not infer a market provider default from trading provider params', async () => {
    await renderHeader()

    expect(container.textContent).toContain('Market provider')
    expect(mockEmitPortfolioSnapshotParamsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          marketProvider: expect.any(String),
        }),
      })
    )
  })

  it('resets provider-scoped selections when the trading provider changes', async () => {
    await renderHeader()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="trading-provider-selector"]')
        ?.click()
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        provider: 'tradier',
        portfolioIdentity: null,
        credentialServiceId: null,
        selectedWindow: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('updates the account id from account selection', async () => {
    await renderHeader()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')?.click()
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        portfolioIdentity: {
          providerId: 'alpaca',
          credentialId: 'credential-1',
          credentialServiceId: 'alpaca-live',
          accountId: 'acct-1',
        },
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('renders trading provider immediately before the single account selector', async () => {
    await renderHeader()

    const providerButton = container.querySelector('[data-testid="trading-provider-selector"]')
    const accountButton = container.querySelector('[data-testid="account-selector"]')

    expect(providerButton).toBeTruthy()
    expect(accountButton).toBeTruthy()
    expect(container.textContent).not.toContain('Provider settings')

    if (!providerButton || !accountButton) {
      throw new Error('Expected provider and account selector controls')
    }

    expect(
      providerButton.compareDocumentPosition(accountButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('emits a runtime refresh timestamp when the refresh button is clicked', async () => {
    await renderHeader()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Refresh portfolio snapshot"]')
        ?.click()
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        runtime: {
          refreshAt: expect.any(Number),
        },
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('hides trading controls when no trading providers are configured', async () => {
    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {},
      })
    )

    await renderHeader()

    expect(container.querySelector('[data-testid="trading-provider-selector"]')).toBeNull()
    expect(container.querySelector('[data-testid="account-selector"]')).toBeNull()
  })

  it('requires selecting a trading provider before showing the account selector', async () => {
    await renderHeader(null)

    expect(container.querySelector('[data-testid="trading-provider-selector"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="account-selector"]')).toBeNull()
  })
})
