/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { useListingSelectorStore } from '@/stores/market/selector/store'

const requestListingResolutionMock = vi.hoisted(() => vi.fn())
const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: requestListingResolutionMock,
}))

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

const identity = (symbol: string): ListingIdentity => ({
  listing_id: symbol,
  base_id: '',
  quote_id: '',
  listing_type: 'default',
})

const resolved = (symbol: string): ListingResolved => ({
  listingIdentity: identity(symbol),
  base: symbol,
  quote: null,
  name: symbol,
})

const defer = <T,>() => {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve,
  }
}

describe('ListingSearchInput', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    requestListingResolutionMock.mockReset()
    useListingSelectorStore.setState({ instances: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('ignores stale hydration after the selected identity changes or typing clears it', async () => {
    const requests: Array<ReturnType<typeof defer<ListingResolved | null>>> = []
    const onListingValueChange = vi.fn()
    requestListingResolutionMock.mockImplementation(() => {
      const request = defer<ListingResolved | null>()
      requests.push(request)
      return request.promise
    })
    useListingSelectorStore.getState().ensureInstance('selector-test', {
      selectedListing: identity('AAPL'),
    })

    await act(async () => {
      root.render(
        <ListingSearchInput
          instanceId='selector-test'
          onListingValueChange={onListingValueChange}
        />
      )
      await Promise.resolve()
    })

    act(() =>
      useListingSelectorStore.getState().updateInstance('selector-test', {
        selectedListing: identity('MSFT'),
      })
    )
    await act(async () => Promise.resolve())
    await act(async () => {
      requests[0].resolve(resolved('AAPL'))
      await Promise.resolve()
    })
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      selectedListing: identity('MSFT'),
    })

    const input = container.querySelector('input')
    if (!input) throw new Error('Expected listing input')
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'TSLA')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onListingValueChange).toHaveBeenCalledWith(null)
    await act(async () => {
      requests[1].resolve(resolved('MSFT'))
      await Promise.resolve()
    })
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      query: 'TSLA',
      selectedListing: null,
    })
  })

  it('hydrates the selected identity into one resolved selection', async () => {
    requestListingResolutionMock.mockResolvedValue(resolved('MSFT'))
    useListingSelectorStore.getState().ensureInstance('selector-test', {
      selectedListing: identity('MSFT'),
    })

    await act(async () => {
      root.render(<ListingSearchInput instanceId='selector-test' />)
      await Promise.resolve()
    })

    expect(requestListingResolutionMock).toHaveBeenCalledWith(identity('MSFT'))
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      selectedListing: resolved('MSFT'),
    })
  })

  it.each([
    ['null', null],
    ['rejection', new Error('Listing resolution unavailable')],
  ])('keeps the identity label when hydration ends in %s', async (_outcomeName, outcome) => {
    if (outcome instanceof Error) {
      requestListingResolutionMock.mockRejectedValue(outcome)
    } else {
      requestListingResolutionMock.mockResolvedValue(outcome)
    }
    useListingSelectorStore.getState().ensureInstance('selector-test', {
      selectedListing: identity('MSFT'),
      query: '',
    })

    await act(async () => {
      root.render(<ListingSearchInput instanceId='selector-test' />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestListingResolutionMock).toHaveBeenCalledWith(identity('MSFT'))
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('MSFT')
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      query: 'MSFT',
      selectedListing: identity('MSFT'),
    })
  })

  it('does not rehydrate complete resolved data for the selected identity', async () => {
    useListingSelectorStore.getState().ensureInstance('selector-test', {
      selectedListing: resolved('AAPL'),
    })

    await act(async () => {
      root.render(<ListingSearchInput instanceId='selector-test' />)
      await Promise.resolve()
    })

    expect(requestListingResolutionMock).not.toHaveBeenCalled()
  })
})
