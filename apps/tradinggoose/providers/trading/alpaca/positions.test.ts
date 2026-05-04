import { describe, expect, it } from 'vitest'
import { normalizeAlpacaPositions } from '@/providers/trading/alpaca/positions'

describe('normalizeAlpacaPositions', () => {
  it('normalizes supported broker symbols into listing identities', () => {
    expect(
      normalizeAlpacaPositions([
        {
          symbol: 'AAPL',
          asset_class: 'us_equity',
          qty: '2',
          side: 'long',
        },
      ])[0]?.symbol.listing
    ).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })

    const cryptoPosition = normalizeAlpacaPositions([
      {
        symbol: 'DOGEUSD',
        asset_class: 'crypto',
        qty: '10',
        side: 'long',
      },
    ])[0]

    expect(cryptoPosition?.symbol).toMatchObject({
      base: 'DOGE',
      quote: 'USD',
      assetClass: 'crypto',
      listing: {
        listing_id: '',
        base_id: 'DOGE',
        quote_id: 'USD',
        listing_type: 'crypto',
      },
    })
  })
})
