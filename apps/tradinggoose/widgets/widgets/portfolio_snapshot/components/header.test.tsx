/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPortfolioSnapshotHeader } from '@/widgets/widgets/portfolio_snapshot/components/header'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockEmitPortfolioSnapshotParamsChange = vi.fn()

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
}))

vi.mock('@/widgets/utils/portfolio-snapshot-params', () => ({
  emitPortfolioSnapshotParamsChange: (...args: unknown[]) =>
    mockEmitPortfolioSnapshotParamsChange(...args),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: (className?: string) =>
    ['controls', className].filter(Boolean).join(' '),
  widgetHeaderControlClassName: (className?: string) =>
    ['control', className].filter(Boolean).join(' '),
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuContentClassName: 'menu-content',
  widgetHeaderMenuItemClassName: 'menu-item',
  widgetHeaderMenuTextClassName: 'menu-text',
}))

vi.mock('@/widgets/widgets/components/trading-provider-selector', async () => {
  const React = await import('react')

  return {
    resolveTradingProviderIcon: () => undefined,
    TradingProviderSelector: ({
      value,
      options,
      onChange,
      disabled,
    }: {
      value?: string
      options: Array<{ id: string; name: string }>
      onChange?: (providerId: string) => void
      disabled?: boolean
    }) => (
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value=''>Select provider</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    ),
  }
})

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal',
  () => ({
    OAuthRequiredModal: () => null,
  })
)

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button type='button' onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
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
          alpaca: true,
          tradier: true,
        },
      })
    )
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [
          { id: 'cred-1', name: 'Primary Broker', provider: 'alpaca' },
          { id: 'cred-2', name: 'Secondary Broker', provider: 'alpaca' },
        ],
      })
    )
    mockUseTradingAccounts.mockReturnValue(
      createQueryResult({
        data: [
          { id: 'acct-1', name: 'Paper Account', type: 'paper', baseCurrency: 'USD' },
          { id: 'acct-2', name: 'Live Account', type: 'margin', baseCurrency: 'USD' },
        ],
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
      environment: 'paper',
      credentialId: 'cred-1',
      accountId: 'acct-1',
      selectedWindow: '1D',
    }
  ) => {
    const slots = renderPortfolioSnapshotHeader?.({
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

  it('resets provider-scoped selections when the provider changes', async () => {
    await renderHeader()

    const selects = Array.from(container.querySelectorAll('select'))

    await act(async () => {
      selects[0]?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const providerSelect = selects[0] as HTMLSelectElement | undefined
    if (providerSelect) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      valueSetter?.call(providerSelect, 'tradier')
      await act(async () => {
        providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        provider: 'tradier',
        environment: 'live',
        credentialId: null,
        accountId: null,
        selectedWindow: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('clears the selected account when the environment changes', async () => {
    await renderHeader()

    const liveEnvironmentButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Live'
    )
    expect(liveEnvironmentButton).toBeTruthy()

    await act(async () => {
      liveEnvironmentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        environment: 'live',
        accountId: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('updates the selected credential and resets the account selection', async () => {
    await renderHeader()

    const credentialOption = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Secondary Broker')
    )

    expect(credentialOption).toBeTruthy()

    await act(async () => {
      credentialOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: {
        credentialId: 'cred-2',
        accountId: null,
      },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('updates the selected broker account', async () => {
    await renderHeader()

    const accountOption = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Live Account')
    )
    expect(accountOption).toBeTruthy()

    await act(async () => {
      accountOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockEmitPortfolioSnapshotParamsChange).toHaveBeenCalledWith({
      params: { accountId: 'acct-2' },
      panelId: 'panel-1',
      widgetKey: 'portfolio_snapshot',
    })
  })

  it('renders the provider selector immediately before the account selector', async () => {
    await renderHeader()

    expect(container.querySelector('button[aria-label="Select trading connection"]')).toBeNull()
    const providerSelect = container.querySelector('select')
    const accountButton = container.querySelector('button[aria-label="Select trading account"]')

    expect(providerSelect).toBeTruthy()
    expect(accountButton).toBeTruthy()
    if (!providerSelect || !accountButton) {
      throw new Error('Expected provider selector and account button to be rendered')
    }
    expect(
      providerSelect.compareDocumentPosition(accountButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('emits a runtime refresh timestamp when the refresh button is clicked', async () => {
    await renderHeader()

    const refreshButton = container.querySelector('button[aria-label="Refresh portfolio snapshot"]')
    expect(refreshButton).toBeTruthy()

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

  it('does not query accounts for a stale credential on an invalid persisted provider', async () => {
    await renderHeader({
      provider: 'stale-provider',
      environment: 'paper',
      credentialId: 'stale-cred',
      accountId: 'acct-1',
      selectedWindow: '1D',
    })

    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
    })
  })

  it('uses the saved credential id for account queries even when the credential list query errors', async () => {
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [],
        error: new Error('credential fetch failed'),
      })
    )

    await renderHeader()

    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
    })
  })

  it('does not query accounts when the saved credential no longer exists', async () => {
    mockUseOAuthCredentials.mockReturnValue(
      createQueryResult({
        data: [{ id: 'cred-2', name: 'Replacement Broker', provider: 'alpaca' }],
      })
    )

    await renderHeader()

    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: undefined,
      environment: 'paper',
    })
    expect(
      (
        container.querySelector(
          'button[aria-label="Select trading account"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true)
  })

  it('keeps the account picker interactive when broker account loading fails', async () => {
    mockUseTradingAccounts.mockReturnValue(
      createQueryResult({
        data: [],
        error: new Error('accounts fetch failed'),
      })
    )

    await renderHeader()

    expect(
      (
        container.querySelector(
          'button[aria-label="Select trading account"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(false)
  })

  it('hides provider controls when no trading providers are configured', async () => {
    mockUseOAuthProviderAvailability.mockReturnValue(
      createQueryResult({
        data: {},
      })
    )

    await renderHeader()

    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
    })
  })

  it('requires selecting a provider before enabling the account selector', async () => {
    await renderHeader(null)

    expect(container.querySelectorAll('select')).toHaveLength(1)
    expect(
      (
        container.querySelector(
          'button[aria-label="Select trading account"]'
        ) as HTMLButtonElement | null
      )?.disabled
    ).toBe(true)
    expect(mockUseTradingAccounts).toHaveBeenCalledWith({
      provider: undefined,
      credentialId: undefined,
      environment: undefined,
    })
  })

  it('keeps account selection separate from provider connection selection', async () => {
    await renderHeader({
      provider: 'alpaca',
      environment: 'paper',
      selectedWindow: '1D',
    })

    const accountButton = container.querySelector(
      'button[aria-label="Select trading account"]'
    ) as HTMLButtonElement | null

    expect(accountButton?.textContent).toContain('Select account')
    expect(accountButton?.textContent).not.toContain('Connect Alpaca')
    expect(accountButton?.disabled).toBe(true)
  })

  it('does not trigger a hook-order warning when provider availability resolves after loading', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockUseOAuthProviderAvailability
      .mockReturnValueOnce(
        createQueryResult({
          data: undefined,
          isLoading: true,
        })
      )
      .mockReturnValueOnce(
        createQueryResult({
          data: {
            alpaca: true,
            tradier: true,
          },
        })
      )

    await renderHeader()

    await renderHeader()

    expect(
      consoleErrorSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' && message.includes('change in the order of Hooks')
      )
    ).toBe(false)

    consoleErrorSpy.mockRestore()
  })
})
