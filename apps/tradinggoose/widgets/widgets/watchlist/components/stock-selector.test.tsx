/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { StockSelector } from '@/widgets/widgets/watchlist/components/stock-selector'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

vi.mock('@/components/listing-selector/selector/use-listing-search', () => ({
  useMarketListingSearch: vi.fn(),
}))

describe('Watchlist StockSelector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useListingSelectorStore.setState({ instances: {} })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.useRealTimers()
  })

  it('activates populated selectors on mount so the current listing is editable and the dropdown opens', async () => {
    useListingSelectorStore.setState({
      instances: {
        'test-selector': createEmptyListingSelectorInstance({
          providerId: 'alpaca',
          query: '',
          selectedListingValue: {
            listing_id: 'BTCUSD',
            base_id: 'BTC',
            quote_id: 'USD',
            listing_type: 'default',
          },
          selectedListing: {
            listing_id: 'BTCUSD',
            base_id: 'BTC',
            quote_id: 'USD',
            listing_type: 'default',
            base: 'BTC',
            quote: 'USD',
            name: 'Bitcoin',
          },
        }),
      },
    })

    await act(async () => {
      root.render(
        <StockSelector
          instanceId='test-selector'
          providerType='market'
          activateOnMount
        />
      )
    })

    await act(async () => {
      vi.runAllTimers()
    })

    const input = container.querySelector('input')
    const dropdown = document.body.querySelector('[data-market-selector-id="test-selector"]')

    expect(input).toBeTruthy()
    expect(input?.value).toBe('BTC/USD')
    expect(document.activeElement).toBe(input)
    expect(dropdown).toBeTruthy()
    expect(document.body.textContent).toContain('No listings found.')
  })
})
