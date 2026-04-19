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

  it('searches immediately on blank open and stores the returned results', async () => {
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
          isVariableInput={() => false}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).toHaveBeenCalledTimes(1)
    expect(fetchListingsMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        search_query: expect.anything(),
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
          isVariableInput={() => false}
        />
      )
      await Promise.resolve()
    })

    expect(fetchListingsMock).toHaveBeenCalledTimes(1)
    expect(fetchListingsMock).toHaveBeenLastCalledWith(
      expect.not.objectContaining({
        search_query: expect.anything(),
      }),
      expect.any(AbortSignal)
    )

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
          isVariableInput={() => false}
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
          isVariableInput={() => false}
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
          isVariableInput={() => false}
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
          isVariableInput={() => false}
        />
      )
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()
    expect(updateInstance).toHaveBeenCalledWith('test-selector', {
      isLoading: false,
      error: undefined,
    })
  })
})
