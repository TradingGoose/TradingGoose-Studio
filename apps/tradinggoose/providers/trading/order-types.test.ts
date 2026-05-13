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
  it('uses strict listing filtering for quick order decisions', () => {
    expect(getStrictTradingOrderTypeDefinitions('tradier', { listing: stockListing })).toEqual([
      expect.objectContaining({ id: 'market' }),
      expect.objectContaining({ id: 'limit' }),
      expect.objectContaining({ id: 'stop' }),
      expect.objectContaining({ id: 'stop_limit' }),
    ])
  })

  it('filters Tradier order types by selected order class', () => {
    expect(
      getStrictTradingOrderTypeDefinitions('tradier', {
        listing: stockListing,
        orderClass: 'multileg',
      }).map((definition) => definition.id)
    ).toEqual(['market', 'debit', 'credit', 'even'])
  })

  it('does not expose order options when a provider cannot trade the listing', () => {
    expect(getStrictTradingOrderTypeDefinitions('tradier', { listing: cryptoListing })).toEqual([])
    expect(getTradingOrderTypeOptions('tradier', { listing: cryptoListing })).toEqual([])
  })

  it('applies provider availability without returning unsupported generic options', () => {
    expect(
      getStrictTradingOrderTypeDefinitions('tradier', { listing: assetlessListing }).length
    ).toBeGreaterThan(0)
    expect(getStrictTradingOrderTypeDefinitions('alpaca', { listing: etfListing })).toEqual([])
    expect(
      getStrictTradingOrderTypeDefinitions('alpaca', { listing: cryptoListing }).map(
        (definition) => definition.id
      )
    ).toEqual(['market', 'limit', 'stop_limit'])
    expect(getTradingOrderTypeOptions('alpaca', { listing: etfListing })).toEqual([])
  })
})
