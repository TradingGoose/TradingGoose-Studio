/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordsOrderKeys } from '@/hooks/queries/records-orders'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'

const mockUseOAuthProviderAvailability = vi.fn()
const mockUseOAuthConnections = vi.fn()
const mockUseMarketQuoteSnapshots = vi.fn()
const mockUsePortfolioIdentities = vi.fn()
const mockUsePortfolioDetail = vi.fn()
const mockSubmitTradingOrder = vi.fn()
const mockPortfolioRefetch = vi.fn()

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-account-1',
  serviceId: 'alpaca-live',
  accountId: 'acct-1',
  accountName: 'Paper Account',
  accountType: 'paper' as const,
  baseCurrency: 'USD',
  accountStatus: 'active' as const,
}

const createPortfolioDetail = () => ({
  ...portfolioIdentity,
  environment: 'live' as const,
  asOf: '2026-04-25T12:00:00.000Z',
  cashBalances: [],
  positions: [],
  orders: [],
  summary: {
    totalPortfolioValue: 1000,
    totalCashValue: 62.77,
    buyingPower: 62.77,
  },
})

const submittedOrder = {
  appOrderId: 'app-order-1',
  clientOrderId: 'client-order-1',
  provider: 'alpaca',
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
}

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

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

const defaultParams = { provider: 'alpaca', portfolioIdentity, side: 'buy' } as const

let nextListing: Record<string, unknown> = stockListing
let queryClient: QueryClient

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

vi.mock('@/hooks/queries/oauth-connections', () => ({
  useOAuthConnections: (...args: unknown[]) => mockUseOAuthConnections(...args),
}))

vi.mock('@/hooks/queries/market-quote-snapshots', () => ({
  useMarketQuoteSnapshots: (...args: unknown[]) => mockUseMarketQuoteSnapshots(...args),
}))

vi.mock('@/hooks/queries/trading-portfolio', () => ({
  usePortfolioIdentities: (...args: unknown[]) => mockUsePortfolioIdentities(...args),
  usePortfolioDetail: (...args: unknown[]) => mockUsePortfolioDetail(...args),
  submitTradingOrder: (...args: unknown[]) => mockSubmitTradingOrder(...args),
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

vi.mock('@/components/listing-selector/selector/combo', () => ({
  ListingSelector: ({
    instanceId,
    providerType,
    marketProviderId,
    tradingProviderId,
    listingRequired,
    className,
    disabled,
    onListingChange,
    onListingValueChange,
  }: {
    instanceId: string
    providerType: string
    marketProviderId?: string
    tradingProviderId?: string
    listingRequired?: boolean
    className?: string
    disabled?: boolean
    onListingChange: (listing: Record<string, unknown>) => void
    onListingValueChange: (value: string) => void
  }) => (
    <div
      data-testid='listing-selector-surface'
      data-instance-id={instanceId}
      data-provider-type={providerType}
      data-market-provider-id={marketProviderId ?? ''}
      data-trading-provider-id={tradingProviderId ?? ''}
      data-listing-required={listingRequired ? 'true' : 'false'}
      data-class-name={className ?? ''}
    >
      <button
        type='button'
        data-testid='listing-selector'
        disabled={disabled}
        onClick={() => onListingChange(nextListing)}
      >
        AAPL
      </button>
      <button
        type='button'
        data-testid='listing-value-selector'
        disabled={disabled}
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
  onWidgetParamsPatch = vi.fn()
) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <QuickOrderWidgetBody
          channelId='quick-order-panel-1'
          context={{ workspaceId: 'workspace-1' } as any}
          widget={{ key: 'quick_order' } as any}
          panelId='panel-1'
          params={params}
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      </QueryClientProvider>
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

const selectListing = (container: HTMLElement) =>
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="listing-selector"]')?.click())

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
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })

    mockUseOAuthProviderAvailability.mockReturnValue(
      queryResult({ data: { 'alpaca-live': true, 'alpaca-paper': true } })
    )
    mockUseOAuthConnections.mockReturnValue(
      queryResult({
        data: [
          { providerId: 'alpaca-live', isConnected: true },
          { providerId: 'alpaca-paper', isConnected: true },
        ],
      })
    )
    mockUsePortfolioIdentities.mockReturnValue(queryResult({ data: [portfolioIdentity] }))
    mockUsePortfolioDetail.mockReturnValue(
      queryResult({ data: createPortfolioDetail(), refetch: mockPortfolioRefetch })
    )
    mockPortfolioRefetch.mockResolvedValue({
      data: createPortfolioDetail(),
      error: null,
    })
    mockSubmitTradingOrder.mockResolvedValue(submittedOrder)
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
    useListingSelectorStore.setState({ instances: {} })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders order body controls and keeps the submit footer pinned as a sibling', async () => {
    await renderBody(container, root, defaultParams)

    expect(container.querySelector('[data-testid="listing-selector"]')).not.toBeNull()
    const footerButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Submit BUY Order')
    )
    expect(footerButton?.parentElement?.className).toContain('shrink-0')
    expect(footerButton).toBeDisabled()
  })

  it('uses user broker connections independently of workspace scope', async () => {
    await renderBody(container, root, defaultParams)

    expect(mockUseOAuthConnections).toHaveBeenCalled()
  })

  it('keeps listing selector state scoped to a stable trading instance and resets on unmount', async () => {
    await renderBody(container, root, defaultParams)

    const selector = container.querySelector<HTMLElement>(
      '[data-testid="listing-selector-surface"]'
    )
    expect(selector?.dataset.instanceId).toBe('quick-order-panel-1-quick_order')
    expect(selector?.dataset.providerType).toBe('trading')
    expect(selector?.dataset.marketProviderId).toBe('')
    expect(selector?.dataset.tradingProviderId).toBe('alpaca')
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
    await renderBody(container, root, defaultParams)

    const emptyOrderTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.textContent?.includes('Select listing first')
    )
    expect(emptyOrderTypeSelect).toBeDisabled()

    nextListing = assetlessListing
    await selectListing(container)

    const assetlessOrderTypeSelect = Array.from(container.querySelectorAll('select')).find(
      (select) => select.textContent?.includes('Asset class unavailable')
    )
    expect(assetlessOrderTypeSelect).toBeDisabled()
    expect(container.textContent).toContain('Resolved listing asset class is required.')
  })

  it('clears unresolved listing values from submit readiness', async () => {
    await renderBody(container, root, defaultParams)

    await selectListing(container)
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
      portfolioIdentity,
      side: 'buy',
    })

    expect(
      container.querySelector<HTMLElement>('[data-testid="listing-selector-surface"]')?.dataset
        .marketProviderId
    ).toBe('finnhub')

    await selectListing(container)
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

  it('does not use trading provider settings for market quote websocket subscriptions', async () => {
    await renderBody(container, root, defaultParams)

    await selectListing(container)
    await act(async () => {})

    expect(mockUseMarketQuoteSnapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        provider: undefined,
        auth: undefined,
        providerParams: undefined,
        enabled: false,
      })
    )
  })

  it('normalizes invalid providers and stale portfolio identities for reads', async () => {
    const onInvalidProviderChange = vi.fn()
    await renderBody(
      container,
      root,
      {
        provider: 'missing-provider',
        portfolioIdentity,
        side: 'buy',
      },
      onInvalidProviderChange
    )
    expect(onInvalidProviderChange).not.toHaveBeenCalled()
    expect(mockUsePortfolioDetail).toHaveBeenLastCalledWith({
      workspaceId: 'workspace-1',
      provider: undefined,
      serviceId: undefined,
      portfolioIdentity: undefined,
    })

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    const onIncompleteAccountOptionsChange = vi.fn()
    const stalePortfolioIdentity = { ...portfolioIdentity, accountId: 'stale-account' }
    const otherPortfolioIdentity = {
      ...portfolioIdentity,
      accountId: 'acct-2',
      accountName: 'Other Account',
    }
    mockUsePortfolioIdentities.mockReturnValue(queryResult({ data: [otherPortfolioIdentity] }))
    await renderBody(
      container,
      root,
      {
        provider: 'alpaca',
        portfolioIdentity: stalePortfolioIdentity,
        side: 'buy',
      },
      onIncompleteAccountOptionsChange
    )
    expect(onIncompleteAccountOptionsChange).not.toHaveBeenCalled()
    expect(mockUsePortfolioDetail).toHaveBeenLastCalledWith({
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity: undefined,
    })
  })

  it('keeps invalid numeric text from becoming a submit payload', async () => {
    await renderBody(container, root, defaultParams)

    await selectListing(container)
    await act(async () => {})

    await setInputValue(container.querySelector<HTMLInputElement>('input[placeholder="0"]'), 'abc')

    const footerButton = findButton(container, 'Submit BUY Order')
    expect(footerButton).toBeDisabled()

    await act(async () => {
      footerButton?.click()
    })
    expect(mockSubmitTradingOrder).not.toHaveBeenCalled()
  })

  it('rejects Alpaca notional trailing stop orders before submit', async () => {
    await renderBody(container, root, defaultParams)

    await selectListing(container)
    await act(async () => {})

    const sizingRadio = container.querySelector<HTMLElement>('[role="radio"]')
    expect(sizingRadio?.tagName).toBe('SPAN')
    expect(sizingRadio?.className).toContain('focus-visible:ring-2')
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
    expect(mockSubmitTradingOrder).not.toHaveBeenCalled()
  })

  it('keeps pending feedback and controls owned until order and account data converge', async () => {
    const orderRequest = createDeferred<typeof submittedOrder>()
    const recordsRefresh = createDeferred<void>()
    const portfolioRefresh = createDeferred<{
      data: ReturnType<typeof createPortfolioDetail>
      error: null
    }>()
    mockSubmitTradingOrder.mockReturnValueOnce(orderRequest.promise)
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockReturnValueOnce(recordsRefresh.promise)
    mockPortfolioRefetch.mockReturnValueOnce(portfolioRefresh.promise)

    await renderBody(container, root, {
      provider: 'alpaca',
      marketProvider: 'finnhub',
      marketProviderParams: { region: 'US' },
      marketAuth: { apiKey: 'market-key' },
      portfolioIdentity,
      side: 'buy',
    })

    await selectListing(container)
    await act(async () => {})

    await setInputValue(container.querySelector<HTMLInputElement>('input[placeholder="0"]'), '2')
    await act(async () => {})

    const submitButton = findButton(container, 'Submit BUY Order')
    await act(async () => {
      submitButton?.focus()
      submitButton?.click()
      submitButton?.click()
    })

    expect(mockSubmitTradingOrder).toHaveBeenCalledTimes(1)
    const payload = mockSubmitTradingOrder.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        idempotencyKey: expect.any(String),
        workspaceId: 'workspace-1',
        portfolioIdentity,
        side: 'buy',
        listing: stockListing,
        orderType: 'market',
        timeInForce: 'day',
        orderSizingMode: 'quantity',
        quantity: 2,
      })
    )
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Submitting')
    expect(container.querySelector<HTMLInputElement>('#quick-order-size')).toBeDisabled()
    expect(findButton(container, 'Submitting')).toHaveAttribute('aria-busy', 'true')

    await renderBody(container, root, { ...defaultParams, side: 'sell' })

    await act(async () => {
      orderRequest.resolve(submittedOrder)
      await Promise.resolve()
    })
    expect(mockPortfolioRefetch).toHaveBeenCalled()
    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: recordsOrderKeys.all },
      { throwOnError: true }
    )
    expect(findButton(container, 'Submitting')).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      recordsRefresh.resolve(undefined)
      await Promise.resolve()
    })
    expect(findButton(container, 'Submitting')).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      portfolioRefresh.resolve({ data: createPortfolioDetail(), error: null })
      await Promise.resolve()
    })

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.textContent).toContain('Order order-1')
    expect(container.textContent).toContain('alpaca / acct-1')
    expect(container.textContent).toContain('AAPL · BUY')
    expect(container.textContent).toContain('Order accepted')
    expect(payload).not.toHaveProperty('tokenAccountId')
    expect(payload).not.toHaveProperty('serviceId')
    expect(payload).not.toHaveProperty('environment')
    expect(payload).not.toHaveProperty('accountId')
    expect(payload).not.toHaveProperty('provider')
    expect(payload).not.toHaveProperty('providerParams')
    expect(payload).not.toHaveProperty('marketProvider')
    expect(payload).not.toHaveProperty('marketProviderParams')
    expect(payload).not.toHaveProperty('marketAuth')
  })

  it('reuses a key only after rejection and preserves accepted orders when convergence fails', async () => {
    mockSubmitTradingOrder.mockRejectedValueOnce(new Error('Order rejected'))
    await renderBody(container, root, defaultParams)

    await selectListing(container)
    await setInputValue(container.querySelector<HTMLInputElement>('input[placeholder="0"]'), '2')

    await act(async () => {
      const submitButton = findButton(container, 'Submit BUY Order')
      submitButton?.click()
      submitButton?.click()
    })

    expect(mockSubmitTradingOrder).toHaveBeenCalledTimes(1)
    const failedKey = mockSubmitTradingOrder.mock.calls[0][0].idempotencyKey
    await act(async () => {})
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Order rejected')

    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(
      new Error('Order records failed to refresh')
    )
    mockPortfolioRefetch.mockResolvedValueOnce({
      data: undefined,
      error: new Error('Portfolio failed to refresh'),
    })
    await act(async () => {
      findButton(container, 'Submit BUY Order')?.click()
      await Promise.resolve()
    })
    expect(mockSubmitTradingOrder).toHaveBeenCalledTimes(2)
    expect(mockSubmitTradingOrder.mock.calls[1][0].idempotencyKey).toBe(failedKey)
    expect(container.textContent).toContain('Order order-1')
    expect(container.textContent).toContain('Order accepted')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'The order was accepted, but refreshed records or portfolio data could not be confirmed.'
    )

    await act(async () => {
      findButton(container, 'Submit BUY Order')?.click()
      await Promise.resolve()
    })
    expect(mockSubmitTradingOrder).toHaveBeenCalledTimes(3)
    expect(mockSubmitTradingOrder.mock.calls[2][0].idempotencyKey).not.toBe(failedKey)
  })
})
