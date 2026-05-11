import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTradingListingIdentity } from '@/providers/trading/listing-resolution'

describe('trading listing resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps canonical market listing identities without a search request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      resolveTradingListingIdentity({
        base: 'AAPL',
        quote: 'USD',
        assetClass: 'stock',
        listing: {
          listing_id: 'TG_LSTG_61E9AA',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      })
    ).resolves.toEqual({
      listing_id: 'TG_LSTG_61E9AA',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves broker stock symbols to canonical listing ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              listing_id: 'TG_LSTG_61E9AA',
              base_id: null,
              quote_id: null,
              listing_type: 'default',
              base: 'AMZN',
              quote: 'USD',
              assetClass: 'stock',
            },
          ],
        }),
        { status: 200 }
      )
    )

    await expect(
      resolveTradingListingIdentity({
        base: 'AMZN',
        quote: 'USD',
        assetClass: 'stock',
        listing: {
          listing_id: 'AMZN',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      })
    ).resolves.toEqual({
      listing_id: 'TG_LSTG_61E9AA',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/market/search?'),
      expect.objectContaining({
        method: 'GET',
      })
    )
    const requestUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(decodeURIComponent(requestUrl)).toContain('search_query=AMZN')
    expect(decodeURIComponent(requestUrl)).toContain('"asset_class":["stock"]')
  })

  it('resolves broker crypto pair codes to canonical market ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              listing_id: null,
              base_id: 'TG_CRYP_A0994C',
              quote_id: 'TG_CURR_27AF50',
              listing_type: 'crypto',
              base: 'ETH',
              quote: 'USD',
              assetClass: 'crypto',
            },
          ],
        }),
        { status: 200 }
      )
    )

    await expect(
      resolveTradingListingIdentity({
        base: 'ETH',
        quote: 'USD',
        assetClass: 'crypto',
        listing: {
          listing_id: '',
          base_id: 'ETH',
          quote_id: 'USD',
          listing_type: 'crypto',
        },
      })
    ).resolves.toEqual({
      listing_id: '',
      base_id: 'TG_CRYP_A0994C',
      quote_id: 'TG_CURR_27AF50',
      listing_type: 'crypto',
    })

    const requestUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(decodeURIComponent(requestUrl)).toContain('search_query=ETH')
    expect(decodeURIComponent(requestUrl)).toContain('crypto_quote_code=USD')
    expect(decodeURIComponent(requestUrl)).toContain('"asset_class":["crypto"]')
  })
})
