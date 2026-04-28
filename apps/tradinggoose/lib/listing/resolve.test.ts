/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { buildResolvedListingFromRows, resolveListingIdentities } from '@/lib/listing/resolve'

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
      listing_id: 'AAPL',
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
      listing_id: 'AAPL',
      base: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'stock',
    })
    expect(resolved[getListingIdentityKey(currencyListing)]).toMatchObject({
      base_id: 'USD',
      quote_id: 'EUR',
      base: 'USD',
      quote: 'EUR',
      name: 'US Dollar to Euro pair',
      assetClass: 'currency',
    })
  })

  it('forwards abort signals through batch market fetches', async () => {
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            base: 'AAPL',
            name: 'Apple Inc.',
          },
        }),
        { status: 200 }
      )
    )

    await resolveListingIdentities(
      [
        {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      ],
      controller.signal
    )

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
      })
    )
  })
})
