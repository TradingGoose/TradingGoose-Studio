/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'
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

const resolved = (symbol: string): ListingOption => ({
  ...identity(symbol),
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

  it('ignores stale hydration after the selected identity changes or clears', async () => {
    const requests: Array<ReturnType<typeof defer<ListingOption | null>>> = []
    requestListingResolutionMock.mockImplementation(() => {
      const request = defer<ListingOption | null>()
      requests.push(request)
      return request.promise
    })
    useListingSelectorStore.getState().ensureInstance('selector-test', {
      selectedListingValue: identity('AAPL'),
    })

    await act(async () => {
      root.render(<ListingSearchInput instanceId='selector-test' />)
      await Promise.resolve()
    })

    act(() =>
      useListingSelectorStore.getState().updateInstance('selector-test', {
        selectedListingValue: identity('MSFT'),
        selectedListing: null,
      })
    )
    await act(async () => Promise.resolve())
    await act(async () => {
      requests[0].resolve(resolved('AAPL'))
      await Promise.resolve()
    })
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      selectedListingValue: identity('MSFT'),
      selectedListing: null,
    })

    act(() =>
      useListingSelectorStore.getState().updateInstance('selector-test', {
        selectedListingValue: null,
        selectedListing: null,
      })
    )
    await act(async () => {
      requests[1].resolve(resolved('MSFT'))
      await Promise.resolve()
    })
    expect(useListingSelectorStore.getState().instances['selector-test']).toMatchObject({
      selectedListingValue: null,
      selectedListing: null,
    })
  })
})
