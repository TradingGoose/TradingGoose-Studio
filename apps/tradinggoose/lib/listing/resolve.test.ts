/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getListingIdentityKey } from '@/lib/listing/identity'
import {
  buildResolvedListingFromRows,
  resolveListingIdentities,
  resolveListingIdentity,
} from '@/lib/listing/resolve'

describe('listing resolve row hydration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds resolved display metadata through the shared row hydration path', () => {
    expect(
      buildResolvedListingFromRows(
        {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        {
          listings: {
            AAPL: {
              base: 'AAPL',
              name: 'Apple Inc.',
              assetClass: 'stock',
              marketCode: 'XNAS',
            },
          },
          currencies: {},
          cryptos: {},
        }
      )
    ).toMatchObject({
      listingIdentity: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      base: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'stock',
      marketCode: 'XNAS',
    })
  })

  it('resolves default and pair identities through shared batch requests', async () => {
    const stockListing = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    const currencyListing = {
      listing_id: '',
      base_id: 'USD',
      quote_id: 'EUR',
      listing_type: 'currency' as const,
    }

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/market/get/listing')) {
        return new Response(
          JSON.stringify({
            data: {
              base: 'AAPL',
              name: 'Apple Inc.',
              assetClass: 'stock',
            },
          }),
          { status: 200 }
        )
      }

      if (url.startsWith('/api/market/get/currency')) {
        return new Response(
          JSON.stringify({
            data: {
              USD: { code: 'USD', name: 'US Dollar' },
              EUR: { code: 'EUR', name: 'Euro' },
            },
          }),
          { status: 200 }
        )
      }

      throw new Error(`Unexpected market request: ${url}`)
    })

    const resolved = await resolveListingIdentities([stockListing, stockListing, currencyListing])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resolved[getListingIdentityKey(stockListing)]).toMatchObject({
      listingIdentity: stockListing,
      base: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'stock',
    })
    expect(resolved[getListingIdentityKey(currencyListing)]).toMatchObject({
      listingIdentity: currencyListing,
      base: 'USD',
      quote: 'EUR',
      name: 'US Dollar to Euro pair',
      assetClass: 'currency',
    })
  })

  it('chunks market batches at the API limit and merges every response', async () => {
    const listings = Array.from({ length: 201 }, (_, index) => ({
      listing_id: `LISTING-${index}`,
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }))
    const batchSizes: number[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://tradinggoose.test')
      const listingIds = url.searchParams.getAll('listing_id')
      batchSizes.push(listingIds.length)
      const rows = Object.fromEntries(
        listingIds.map((listingId) => [listingId, { base: listingId, name: listingId }])
      )

      return new Response(
        JSON.stringify({
          data: listingIds.length === 1 ? rows[listingIds[0]] : rows,
        }),
        { status: 200 }
      )
    })

    const resolved = await resolveListingIdentities(listings)

    expect(batchSizes).toEqual([200, 1])
    expect(Object.keys(resolved)).toHaveLength(201)
    expect(resolved[getListingIdentityKey(listings[200])]).toMatchObject({
      listingIdentity: listings[200],
      base: 'LISTING-200',
    })
  })

  it('preserves successful chunks when another chunk fails', async () => {
    const listings = Array.from({ length: 201 }, (_, index) => ({
      listing_id: `LISTING-${index}`,
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://tradinggoose.test')
      const listingIds = url.searchParams.getAll('listing_id')
      if (listingIds.length === 1) {
        return new Response(JSON.stringify({ error: 'Listing not found' }), { status: 404 })
      }

      return new Response(
        JSON.stringify({
          data: Object.fromEntries(
            listingIds.map((listingId) => [listingId, { base: listingId, name: listingId }])
          ),
        }),
        { status: 200 }
      )
    })

    const resolved = await resolveListingIdentities(listings)

    expect(Object.keys(resolved)).toHaveLength(201)
    expect(Object.values(resolved).filter(Boolean)).toHaveLength(200)
    expect(resolved[getListingIdentityKey(listings[0])]).toMatchObject({
      listingIdentity: listings[0],
      base: 'LISTING-0',
    })
    expect(resolved[getListingIdentityKey(listings[200])]).toBeNull()
  })

  it('preserves healthy families while keeping single resolution failures strict', async () => {
    const stockListing = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    const currencyListing = {
      listing_id: '',
      base_id: 'USD',
      quote_id: 'EUR',
      listing_type: 'currency' as const,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/market/get/listing')) {
        return new Response(JSON.stringify({ data: { base: 'AAPL', name: 'Apple Inc.' } }), {
          status: 200,
        })
      }
      if (url.startsWith('/api/market/get/currency')) {
        return new Response(JSON.stringify({ error: 'Currency resolution unavailable' }), {
          status: 503,
        })
      }
      throw new Error(`Unexpected market request: ${url}`)
    })

    const resolved = await resolveListingIdentities([stockListing, currencyListing])

    expect(resolved[getListingIdentityKey(stockListing)]).toMatchObject({
      listingIdentity: stockListing,
      base: 'AAPL',
    })
    expect(resolved[getListingIdentityKey(currencyListing)]).toBeNull()
    await expect(resolveListingIdentity(currencyListing)).rejects.toThrow(
      'Currency resolution unavailable'
    )
  })

  it('propagates aborts while resolving families independently', async () => {
    const controller = new AbortController()
    const listing = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('Transport failed during cancellation')),
            { once: true }
          )
        })
    )

    const pending = resolveListingIdentities([listing], controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    fetchMock.mockRejectedValueOnce({ name: 'AbortError' })
    await expect(resolveListingIdentities([listing])).rejects.toMatchObject({ name: 'AbortError' })
  })
})
