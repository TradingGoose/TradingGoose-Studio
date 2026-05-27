/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketListingSearch } from '@/components/listing-selector/selector/use-listing-search'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const fetchListingsMock = vi.fn()

vi.mock('@/components/listing-selector/fetchers', () => ({
  fetchListings: (...args: Parameters<typeof fetchListingsMock>) => fetchListingsMock(...args),
}))

function HookHarness(props: Parameters<typeof useMarketListingSearch>[0]) {
  useMarketListingSearch(props)
  return null
}

describe('useMarketListingSearch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    fetchListingsMock.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.useRealTimers()
  })

  it('does not search a blank open selector without query or provider criteria', async () => {
    const updateInstance = vi.fn()

    await act(async () => {
      root.render(
        <HookHarness
          open
          query=''
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()

    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      results: [],
      isLoading: false,
      error: undefined,
    })
  })

  it('searches a blank open selector with combined market and trading provider criteria', async () => {
    const updateInstance = vi.fn()

    fetchListingsMock.mockResolvedValue([])

    await act(async () => {
      root.render(
        <HookHarness
          open
          query=''
          providerType='trading'
          marketProviderId='yahoo-finance'
          tradingProviderId='alpaca'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).toHaveBeenCalledTimes(1)
    const queryParams = fetchListingsMock.mock.calls[0][0] as Record<string, string>
    expect(queryParams.search_query).toBeUndefined()
    expect(queryParams.crypto_quote_code).toBe('[BTC,USD]')
    expect(JSON.parse(queryParams.filters)).toEqual(
      expect.objectContaining({
        limit: 50,
        asset_class: ['stock', 'crypto'],
      })
    )
  })

  it('does not let explicit asset prefixes bypass combined provider criteria', async () => {
    const updateInstance = vi.fn()

    await act(async () => {
      root.render(
        <HookHarness
          open
          query='crypto:BTC'
          providerType='trading'
          marketProviderId='yahoo-finance'
          tradingProviderId='tradier'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      results: [],
      isLoading: false,
      error: undefined,
    })
  })

  it('waits for a debounced non-empty query before searching', async () => {
    const updateInstance = vi.fn()

    fetchListingsMock.mockResolvedValue([
      {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
        base: 'AAPL',
        quote: 'USD',
        name: 'Apple Inc.',
      },
    ])

    await act(async () => {
      root.render(
        <HookHarness
          open
          query=''
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()

    fetchListingsMock.mockClear()
    updateInstance.mockClear()

    await act(async () => {
      root.render(
        <HookHarness
          open
          query='AAPL'
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledTimes(1)
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      isLoading: true,
      error: undefined,
    })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(fetchListingsMock).toHaveBeenCalledTimes(1)
    expect(fetchListingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search_query: 'AAPL',
      }),
      expect.any(AbortSignal)
    )
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      isLoading: true,
      error: undefined,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      results: [
        {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
          base: 'AAPL',
          quote: 'USD',
          name: 'Apple Inc.',
        },
      ],
      isLoading: false,
      error: undefined,
    })
  })

  it('clears the pending loading state when the selector closes before debounce completes', async () => {
    const updateInstance = vi.fn()
    fetchListingsMock.mockResolvedValue([])

    await act(async () => {
      root.render(
        <HookHarness
          open
          query=''
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
      await Promise.resolve()
    })

    fetchListingsMock.mockClear()
    updateInstance.mockClear()

    await act(async () => {
      root.render(
        <HookHarness
          open
          query='AAPL'
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      isLoading: true,
      error: undefined,
    })

    updateInstance.mockClear()

    await act(async () => {
      root.render(
        <HookHarness
          open={false}
          query='AAPL'
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
        />
      )
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      isLoading: false,
      error: undefined,
    })
  })

  it('filters scoped candidate listings without calling market search', async () => {
    const updateInstance = vi.fn()

    await act(async () => {
      root.render(
        <HookHarness
          open
          query='btc'
          providerType='market'
          instanceId='test-selector'
          updateInstance={updateInstance}
          candidateListings={[
            {
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
              base: 'AAPL',
              quote: null,
              name: 'Apple Inc.',
            },
            {
              listing_id: '',
              base_id: 'BTC',
              quote_id: 'USD',
              listing_type: 'crypto',
              base: 'BTC',
              quote: 'USD',
              name: 'BTC/USD',
            },
          ]}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      results: [
        {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USD',
          listing_type: 'crypto',
          base: 'BTC',
          quote: 'USD',
          name: 'BTC/USD',
        },
      ],
      isLoading: false,
      error: undefined,
    })
  })
})
