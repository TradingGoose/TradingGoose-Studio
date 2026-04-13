/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingSelector } from '@/widgets/widgets/components/listing-selector'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { ListingOption } from '@/lib/listing/identity'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const fetchListingsMock = vi.fn()

vi.mock('@/components/listing-selector/fetchers', () => ({
  fetchListings: (...args: Parameters<typeof fetchListingsMock>) => fetchListingsMock(...args),
}))

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  checkTagTrigger: () => ({ show: false }),
  TagDropdown: () => null,
}))

vi.mock('@/components/ui/formatted-text', () => ({
  formatDisplayText: (value: string) => value,
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: () => null,
}))

vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: vi.fn(async () => null),
}))

vi.mock('@/components/listing-selector/listing/rank-updates', () => ({
  triggerCryptoRankUpdate: vi.fn(),
  triggerCurrencyRankUpdate: vi.fn(),
  triggerListingRankUpdate: vi.fn(),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderControlClassName: (className?: string) =>
    ['trigger', className].filter(Boolean).join(' '),
}))

describe('ListingSelector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    fetchListingsMock.mockReset()
    useListingSelectorStore.setState({ instances: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
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

  it('fires a debounced market search after the user types into the open selector', async () => {
    fetchListingsMock.mockResolvedValue([])

    await act(async () => {
      root.render(<ListingSelector instanceId='listing-selector-test' />)
    })

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()

    await act(async () => {
      input?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'AAPL')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(fetchListingsMock).not.toHaveBeenCalled()

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
  })

  it('renders blank-open search results in the dropdown', async () => {
    const apple: ListingOption = {
      listing_id: 'TG_LSTG_E7581A',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
      base: 'AAPL',
      quote: 'USD',
      name: 'Apple Inc.',
      iconUrl: '',
      assetClass: 'stock',
    }
    fetchListingsMock.mockResolvedValue([apple])

    await act(async () => {
      root.render(<ListingSelector instanceId='listing-selector-blank-results-test' />)
    })

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()

    await act(async () => {
      input?.focus()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchListingsMock).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('AAPL')
    expect(document.body.textContent).toContain('Apple Inc.')
  })

  it('renders fetched search results in the dropdown', async () => {
    const apple: ListingOption = {
      listing_id: 'TG_LSTG_E7581A',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
      base: 'AAPL',
      quote: 'USD',
      name: 'Apple Inc.',
      iconUrl: '',
      assetClass: 'stock',
    }
    fetchListingsMock.mockResolvedValue([apple])

    await act(async () => {
      root.render(<ListingSelector instanceId='listing-selector-results-test' />)
    })

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()

    await act(async () => {
      input?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'AAPL')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      vi.advanceTimersByTime(400)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('AAPL')
    expect(document.body.textContent).toContain('Apple Inc.')
  })

  it('clears the existing selection when the user types a different query', async () => {
    const selectedListing: ListingOption = {
      listing_id: 'TG_LSTG_E7581A',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
      base: 'AAPL',
      quote: 'USD',
      name: 'Apple Inc.',
      iconUrl: '',
      assetClass: 'stock',
    }

    useListingSelectorStore.setState({
      instances: {
        'listing-selector-selected-test': {
          query: 'AAPL',
          results: [],
          isLoading: false,
          error: undefined,
          selectedListing,
          selectedListingValue: {
            listing_id: selectedListing.listing_id,
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      },
    })

    await act(async () => {
      root.render(<ListingSelector instanceId='listing-selector-selected-test' />)
    })

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()

    await act(async () => {
      input?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'MSFT')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const instance =
      useListingSelectorStore.getState().instances['listing-selector-selected-test']
    expect(instance?.selectedListing).toBeNull()
    expect(instance?.selectedListingValue).toBeNull()
    expect(instance?.query).toBe('MSFT')
  })
})
