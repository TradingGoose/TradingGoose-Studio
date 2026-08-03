/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { type ListingState, useListingState } from './use-listing-state'

const mockResolve = vi.hoisted(() => vi.fn())

vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: mockResolve,
}))

const APPLE_IDENTITY: ListingIdentity = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}
const APPLE_OPTION: ListingResolved = {
  listingIdentity: APPLE_IDENTITY,
  base: 'AAPL',
  quote: null,
  name: 'Apple Inc.',
}
const MSFT_IDENTITY: ListingIdentity = {
  listing_id: 'MSFT',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}
const MSFT_OPTION: ListingResolved = {
  listingIdentity: MSFT_IDENTITY,
  base: 'MSFT',
  quote: null,
  name: 'Microsoft Corp.',
}

let latest: ListingState
function Harness({ listingValue }: { listingValue: ListingIdentity | null }) {
  latest = useListingState({ listingValue })
  return null
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('useListingState', () => {
  let container: HTMLDivElement
  let root: Root
  let pending: Array<(value: ListingResolved | null) => void>

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    pending = []
    mockResolve.mockReset()
    mockResolve.mockImplementation(
      () => new Promise<ListingResolved | null>((resolve) => pending.push(resolve))
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (listingValue: ListingIdentity | null) => {
    await act(async () => {
      root.render(<Harness listingValue={listingValue} />)
    })
  }

  const settleNextResolution = async (value: ListingResolved | null) => {
    await act(async () => {
      pending.shift()?.(value)
      await Promise.resolve()
    })
  }

  it('resolves the identity into full listing details', async () => {
    await render(APPLE_IDENTITY)
    expect(latest.isResolving).toBe(true)
    expect(latest.resolvedListing).toBeNull()
    expect(mockResolve).toHaveBeenCalledTimes(1)

    await settleNextResolution(APPLE_OPTION)
    expect(latest.isResolving).toBe(false)
    expect(latest.resolvedListing).toEqual(APPLE_OPTION)
  })

  it('does not cancel or restart an in-flight resolution when the listing value is a new object for the same identity', async () => {
    await render(APPLE_IDENTITY)
    expect(mockResolve).toHaveBeenCalledTimes(1)

    // A fresh object with an identical identity — mirrors Yjs-backed widget
    // params handing `params.listing` a new reference on unrelated updates.
    await render({ ...APPLE_IDENTITY })
    expect(mockResolve).toHaveBeenCalledTimes(1)

    await settleNextResolution(APPLE_OPTION)
    expect(latest.isResolving).toBe(false)
    expect(latest.resolvedListing).toEqual(APPLE_OPTION)
  })

  it('re-resolves when the identity actually changes', async () => {
    await render(APPLE_IDENTITY)
    await settleNextResolution(APPLE_OPTION)
    expect(latest.resolvedListing).toEqual(APPLE_OPTION)

    await render(MSFT_IDENTITY)
    expect(mockResolve).toHaveBeenCalledTimes(2)
    expect(latest.isResolving).toBe(true)
    expect(latest.resolvedListing).toBeNull()

    await settleNextResolution(MSFT_OPTION)
    expect(latest.resolvedListing).toEqual(MSFT_OPTION)
  })

  it('reports no resolution work when there is no listing', async () => {
    await render(null)
    expect(latest.isResolving).toBe(false)
    expect(latest.resolvedListing).toBeNull()
    expect(latest.listingIdentitySignature).toBeNull()
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
