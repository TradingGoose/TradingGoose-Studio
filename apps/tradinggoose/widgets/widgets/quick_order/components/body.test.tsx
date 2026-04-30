/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn()
const mockUseTradingAccounts = vi.fn()
const mockUseTradingPortfolioSnapshot = vi.fn()
const mockUseSubmitTradingOrder = vi.fn()
const mockMutate = vi.fn()
const mockReset = vi.fn()

const stockListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const assetlessListing = {
  listing_type: 'default',
  listing_id: 'MSFT',
  base_id: '',
  quote_id: '',
  base: 'MSFT',
  quote: 'USD',
}

let nextListing: Record<string, unknown> = stockListing

vi.mock('@/hooks/queries/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => mockUseOAuthCredentials(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (...args: unknown[]) => mockUseMarketQuoteSnapshots(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
  useTradingPortfolioSnapshot: (...args: unknown[]) => mockUseTradingPortfolioSnapshot(...args),
  useSubmitTradingOrder: (...args: unknown[]) => mockUseSubmitTradingOrder(...args),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    disabled,
    onValueChange,
    children,
  }: {
    value?: string
    disabled?: boolean
    onValueChange?: (value: string) => void
    children?: ReactNode
  }) => (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value=''>{placeholder}</option>
  ),
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('@/components/ui/radio-group', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const RadioContext = React.createContext<{
    value?: string
    onValueChange?: (value: string) => void
  }>({})

  return {
    RadioGroup: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children?: ReactNode
    }) => (
      <RadioContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </RadioContext.Provider>
    ),
    RadioGroupItem: ({ id, value }: { id?: string; value: string }) => {
      const context = React.useContext(RadioContext)
      return (
        <input
          id={id}
          type='radio'
          value={value}
          checked={context.value === value}
          onChange={() => context.onValueChange?.(value)}
        />
      )
    },
  }
})

vi.mock('@/components/listing-selector/selector/combo', () => ({
  ListingSelector: ({
    instanceId,
    providerType,
    listingRequired,
    className,
    onListingChange,
    onListingValueChange,
  }: {
    instanceId: string
    providerType: string
    listingRequired?: boolean
    className?: string
    onListingChange: (listing: Record<string, unknown>) => void
    onListingValueChange: (value: string) => void
  }) => (
    <div
      data-testid='listing-selector-surface'
      data-instance-id={instanceId}
      data-provider-type={providerType}
      data-listing-required={listingRequired ? 'true' : 'false'}
      data-class-name={className ?? ''}
    >
      <button
        type='button'
        data-testid='listing-selector'
        onClick={() => onListingChange(nextListing)}
      >
        AAPL
      </button>
      <button
        type='button'
        data-testid='listing-value-selector'
        onClick={() => onListingValueChange('AAPL')}
      >
        Raw AAPL
      </button>
    </div>
  ),
}))

const queryResult = <T,>(overrides: Partial<T> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }) as T

const renderBody = async (
  container: HTMLDivElement,
  root: Root,
  params: Record<string, unknown>,
  onWidgetParamsChange = vi.fn()
) => {
  await act(async () => {
    root.render(
      <QuickOrderWidgetBody
        context={{ workspaceId: 'workspace-1' } as any}
        widget={{ key: 'quick_order' } as any}
        panelId='panel-1'
        params={params}
        onWidgetParamsChange={onWidgetParamsChange}
      />
    )
  })
}

const setInputValue = async (input: HTMLInputElement | null, value: string) => {
  await act(async () => {
    if (!input) throw new Error('input missing')
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const setSelectValue = async (select: HTMLSelectElement | null, value: string) => {
  await act(async () => {
    if (!select) throw new Error('select missing')
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    )?.set
    valueSetter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const chooseRadioValue = async (container: HTMLElement, value: string) => {
  await act(async () => {
    const radio = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)
    if (!radio) throw new Error(`radio ${value} missing`)
    radio.click()
  })
}

const findButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label)
  )

describe('QuickOrderWidgetBody', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    nextListing = stockListing
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockUseOAuthProviderAvailability.mockReturnValue(queryResult({ data: { alpaca: true } }))
    mockUseOAuthCredentials.mockReturnValue(
      queryResult({ data: [{ id: 'cred-1', name: 'Primary' }] })
    )
    mockUseTradingAccounts.mockReturnValue(
      queryResult({ data: [{ id: 'acct-1', name: 'Paper Account' }] })
    )
    mockUseTradingPortfolioSnapshot.mockReturnValue(
      queryResult({
        data: {
          asOf: '2026-04-25T12:00:00.000Z',
          account: {
            id: 'acct-1',
            name: 'Paper Account',
            type: 'paper',
            baseCurrency: 'USD',
          },
          cashBalances: [],
          positions: [],
          orders: [],
          accountSummary: {
            totalPortfolioValue: 1000,
            totalCashValue: 62.77,
            buyingPower: 62.77,
          },
        },
      })
    )
    mockUseMarketQuoteSnapshots.mockReturnValue(
      queryResult({
        data: {
          AAPL: {
            lastPrice: 12.5,
            previousClose: 12,
            change: 0.5,
            changePercent: 4.16,
          },
        },
      })
    )
    mockUseSubmitTradingOrder.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      data: undefined,
      error: null,
    })
    useListingSelectorStore.setState({ instances: {} })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders order body controls and keeps the submit footer pinned as a sibling', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    expect(container.querySelector('[data-testid="listing-selector"]')).not.toBeNull()
    const footerButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Submit BUY Order')
    )
    expect(footerButton?.parentElement?.className).toContain('shrink-0')
    expect(footerButton).toBeDisabled()
  })

  it('keeps listing selector state scoped to a stable trading instance and resets on unmount', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    const selector = container.querySelector<HTMLElement>(
      '[data-testid="listing-selector-surface"]'
    )
    expect(selector?.dataset.instanceId).toBe('quick-order-panel-1-quick_order')
    expect(selector?.dataset.providerType).toBe('trading')
    expect(
      useListingSelectorStore.getState().instances['quick-order-panel-1-quick_order']?.providerId
    ).toBe('alpaca')

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    expect(
      useListingSelectorStore.getState().instances['quick-order-panel-1-quick_order']
    ).toMatchObject({
      providerId: undefined,
      query: '',
      results: [],
      selectedListingValue: null,
      selectedListing: null,
    })
  })

  it('shows disabled order type placeholders before submit-ready listings', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    const emptyOrderTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.textContent?.includes('Select listing first')
    )
    expect(emptyOrderTypeSelect).toBeDisabled()

    nextListing = assetlessListing
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })

    const assetlessOrderTypeSelect = Array.from(container.querySelectorAll('select')).find(
      (select) => select.textContent?.includes('Asset class unavailable')
    )
    expect(assetlessOrderTypeSelect).toBeDisabled()
    expect(container.textContent).toContain('Resolved listing asset class is required.')
  })

  it('clears unresolved listing values from submit readiness', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-value-selector"]')?.click()
    })

    const footerButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Submit BUY Order')
    )
    expect(container.textContent).not.toContain('Select a listing.')
    expect(footerButton).toBeDisabled()
  })

  it('uses configured market data provider settings for quote websocket subscriptions', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      marketProvider: 'finnhub',
      marketProviderParams: { region: 'US' },
      marketAuth: { apiKey: 'market-key' },
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })
    await act(async () => {})

    expect(mockUseMarketQuoteSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        provider: 'finnhub',
        auth: { apiKey: 'market-key' },
        providerParams: { region: 'US' },
        enabled: true,
      })
    )
    expect(mockUseMarketQuoteSnapshots.mock.calls.at(-1)?.[0].items).toEqual([
      expect.objectContaining({
        listing: stockListing,
      }),
    ])
  })

  it('clears invalid providers without deleting saved credential or account params from async lookups', async () => {
    const onInvalidProviderChange = vi.fn()
    await renderBody(
      container,
      root,
      {
        provider: 'missing-provider',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        side: 'buy',
      },
      onInvalidProviderChange
    )
    expect(onInvalidProviderChange).toHaveBeenCalledWith({ side: 'buy' })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    const onIncompleteCredentialOptionsChange = vi.fn()
    mockUseOAuthCredentials.mockReturnValueOnce(queryResult({ data: [] }))
    await renderBody(
      container,
      root,
      {
        provider: 'alpaca',
        credentialId: 'stale-credential',
        environment: 'paper',
        accountId: 'acct-1',
        side: 'buy',
      },
      onIncompleteCredentialOptionsChange
    )
    expect(onIncompleteCredentialOptionsChange).not.toHaveBeenCalled()
    expect(mockUseTradingAccounts).toHaveBeenLastCalledWith({
      provider: 'alpaca',
      credentialId: 'stale-credential',
      environment: 'paper',
    })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    const onIncompleteAccountOptionsChange = vi.fn()
    mockUseTradingAccounts.mockReturnValueOnce(
      queryResult({ data: [{ id: 'acct-2', name: 'Other Account' }] })
    )
    await renderBody(
      container,
      root,
      {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'stale-account',
        side: 'buy',
      },
      onIncompleteAccountOptionsChange
    )
    expect(onIncompleteAccountOptionsChange).not.toHaveBeenCalled()
    expect(mockUseTradingPortfolioSnapshot).toHaveBeenLastCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'stale-account',
    })
  })

  it('keeps invalid numeric text from becoming a submit payload', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })
    await act(async () => {})

    await setInputValue(container.querySelector<HTMLInputElement>('input[placeholder="0"]'), 'abc')

    const footerButton = findButton(container, 'Submit BUY Order')
    expect(footerButton).toBeDisabled()

    await act(async () => {
      footerButton?.click()
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('rejects Alpaca notional trailing stop orders before submit', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })
    await act(async () => {})

    await chooseRadioValue(container, 'notional')
    await setInputValue(
      container.querySelector<HTMLInputElement>('input[placeholder="0.00"]'),
      '100'
    )

    const orderTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.textContent?.includes('Trailing Stop')
    )
    await setSelectValue(orderTypeSelect ?? null, 'trailing_stop')

    const footerButton = findButton(container, 'Submit BUY Order')
    expect(footerButton).toBeDisabled()

    await act(async () => {
      footerButton?.click()
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('submits only the quick order route payload fields', async () => {
    await renderBody(container, root, {
      provider: 'alpaca',
      marketProvider: 'finnhub',
      marketProviderParams: { region: 'US' },
      marketAuth: { apiKey: 'market-key' },
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click()
    })
    await act(async () => {})

    await setInputValue(container.querySelector<HTMLInputElement>('input[placeholder="0"]'), '2')
    await act(async () => {})

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Submit BUY Order'))
        ?.click()
    })

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        side: 'buy',
        listing: stockListing,
        orderType: 'market',
        timeInForce: 'day',
        orderSizingMode: 'quantity',
        quantity: 2,
      })
    )
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('orderClass')
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('providerParams')
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('marketProvider')
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('marketProviderParams')
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('marketAuth')
  })

  it('renders success feedback with destination provider and account details', async () => {
    mockUseSubmitTradingOrder.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      data: {
        provider: 'alpaca',
        environment: 'paper',
        accountId: 'acct-1',
        message: 'Order accepted',
        order: {
          id: 'order-1',
          status: 'submitted',
          symbol: 'AAPL',
          side: 'buy',
          submittedAt: '2026-04-25T12:00:00.000Z',
          raw: {},
        },
      },
      error: null,
    })

    await renderBody(container, root, {
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      accountId: 'acct-1',
      side: 'buy',
    })

    expect(container.textContent).toContain('Order order-1')
    expect(container.textContent).toContain('alpaca / PAPER / acct-1')
    expect(container.textContent).toContain('Order accepted')
  })
})
