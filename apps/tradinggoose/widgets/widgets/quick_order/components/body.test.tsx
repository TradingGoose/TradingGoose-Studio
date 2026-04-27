/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'

const mockUseOAuthCredentials = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()
const mockUseTradingAccounts = vi.fn()
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

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  useTradingAccounts: (...args: unknown[]) => mockUseTradingAccounts(...args),
  useSubmitTradingOrder: (...args: unknown[]) => mockUseSubmitTradingOrder(...args),
}))

vi.mock('@/widgets/widgets/components/listing-selector', () => ({
  ListingSelector: ({
    instanceId,
    providerType,
    onListingChange,
    onListingValueChange,
  }: {
    instanceId: string
    providerType: string
    onListingChange: (listing: Record<string, unknown>) => void
    onListingValueChange: (value: string) => void
  }) => (
    <div
      data-testid='listing-selector-surface'
      data-instance-id={instanceId}
      data-provider-type={providerType}
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
    expect(container.textContent).toContain('Select a listing.')
    expect(footerButton).toBeDisabled()
  })

  it('clears stale provider, credential, and account params through scoped widget updates', async () => {
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

    const onInvalidCredentialChange = vi.fn()
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
      onInvalidCredentialChange
    )
    expect(onInvalidCredentialChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      environment: 'paper',
      side: 'buy',
    })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    const onInvalidAccountChange = vi.fn()
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
      onInvalidAccountChange
    )
    expect(onInvalidAccountChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      credentialId: 'cred-1',
      environment: 'paper',
      side: 'buy',
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
    expect(container.textContent).toContain('Enter a valid quantity.')
    expect(footerButton).toBeDisabled()

    await act(async () => {
      footerButton?.click()
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('rejects Alpaca notional trailing stop orders in the sticky footer validation', async () => {
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

    const sizingSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.textContent?.includes('Notional')
    )
    await setSelectValue(sizingSelect ?? null, 'notional')
    await setInputValue(
      container.querySelector<HTMLInputElement>('input[placeholder="0.00"]'),
      '100'
    )

    const orderTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.textContent?.includes('Trailing Stop')
    )
    await setSelectValue(orderTypeSelect ?? null, 'trailing_stop')

    const footerButton = findButton(container, 'Submit BUY Order')
    expect(container.textContent).toContain(
      'Alpaca notional orders support market, limit, stop, or stop_limit types.'
    )
    expect(footerButton).toBeDisabled()

    await act(async () => {
      footerButton?.click()
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('submits only the quick order route payload fields', async () => {
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
