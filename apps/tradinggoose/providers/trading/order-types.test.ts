import { describe, expect, it } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import {
  getStrictTradingOrderTypeDefinitions,
  getTradingOrderTypeOptions,
} from '@/providers/trading/order-types'

const stockListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const cryptoListing: ListingResolved = {
  listing_type: 'crypto' as const,
  listing_id: '',
  base_id: 'BTC',
  quote_id: 'USD',
  base: 'BTC',
  quote: 'USD',
}

const etfListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'SPY',
  base_id: '',
  quote_id: '',
  base: 'SPY',
  quote: 'USD',
  assetClass: 'etf',
}

const assetlessListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'MSFT',
  base_id: '',
  quote_id: '',
  base: 'MSFT',
  quote: 'USD',
}

describe('trading order type helpers', () => {
  it('uses strict listing/order-class filtering for quick order decisions', () => {
    expect(getStrictTradingOrderTypeDefinitions('tradier', { listing: stockListing })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'market' }),
        expect.objectContaining({ id: 'limit' }),
      ])
    )
    expect(getStrictTradingOrderTypeDefinitions('tradier', { listing: stockListing })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'debit' })])
    )
  })

  it('keeps fallback options for generic callers while strict definitions stay empty', () => {
    expect(getStrictTradingOrderTypeDefinitions('tradier', { listing: cryptoListing })).toEqual([])
    expect(
      getTradingOrderTypeOptions('tradier', { listing: cryptoListing }).length
    ).toBeGreaterThan(0)
  })

  it('applies provider availability and order-class filters without hiding generic fallbacks', () => {
    expect(
      getStrictTradingOrderTypeDefinitions('tradier', { listing: assetlessListing }).length
    ).toBeGreaterThan(0)
    expect(getStrictTradingOrderTypeDefinitions('alpaca', { listing: etfListing })).toEqual([])
    expect(getTradingOrderTypeOptions('alpaca', { listing: etfListing })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'market' })])
    )

    expect(
      getStrictTradingOrderTypeDefinitions('tradier', {
        listing: stockListing,
        orderClass: 'multileg',
      }).map((definition) => definition.id)
    ).toEqual(['market', 'debit', 'credit', 'even'])
  })
})
