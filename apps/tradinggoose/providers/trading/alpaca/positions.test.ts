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
  })
})
