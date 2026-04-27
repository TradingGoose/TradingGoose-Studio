/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockEmitQuickOrderParamsChange = vi.fn()

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
}))

vi.mock('@/widgets/utils/quick-order-params', () => ({
  emitQuickOrderParamsChange: (...args: unknown[]) => mockEmitQuickOrderParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/trading-provider-selector', () => ({
  TradingProviderSelector: ({ onChange }: { onChange: (provider: string) => void }) => (
    <button type='button' data-testid='provider-selector' onClick={() => onChange('tradier')}>
      provider
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/trading-account-selector', () => ({
  TradingAccountSelector: ({
    onAccountSelect,
    disabled,
  }: {
    onAccountSelect: (accountId: string) => void
    disabled?: boolean
  }) => (
    <button
      type='button'
      data-testid='account-selector'
      disabled={disabled}
      onClick={() => onAccountSelect('acct-1')}
    >
      account
    </button>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal',
  () => ({
    OAuthRequiredModal: () => null,
  })
)

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
      queryResult({ data: { alpaca: true, tradier: true } })
    )
    mockUseOAuthCredentials.mockReturnValue(
      queryResult({ data: [{ id: 'cred-1', name: 'Primary' }] })
    )
    mockUseTradingAccounts.mockReturnValue(
      queryResult({ data: [{ id: 'acct-1', name: 'Paper Account' }] })
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
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', credentialId: 'cred-1', environment: 'paper', side: 'buy' },
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
        params: { provider: 'alpaca', credentialId: 'cred-1', environment: 'paper', side: 'buy' },
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
      container.querySelector<HTMLButtonElement>('[data-testid="provider-selector"]')?.click()
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'SELL')
        ?.click()
    })

    expect(mockEmitQuickOrderParamsChange).toHaveBeenCalledWith({
      params: {
        provider: 'tradier',
        environment: 'paper',
        credentialId: null,
        accountId: null,
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

  it('keeps account selection disabled and account query unbound until a credential is selected', () => {
    const header = renderHeader({
      panelId: 'panel-1',
      widget: {
        key: 'quick_order',
        params: { provider: 'alpaca', environment: 'paper', side: 'buy' },
      } as any,
    })

    act(() => {
      root.render(<>{header.left}</>)
    })

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="account-selector"]')
    ).toBeDisabled()
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: undefined,
      environment: 'paper',
    })
  })
})
