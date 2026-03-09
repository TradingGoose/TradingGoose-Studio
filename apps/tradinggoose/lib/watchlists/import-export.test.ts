import { describe, expect, it } from 'vitest'
import {
  exportWatchlistItemsAsJson,
  extractWatchlistListingIdentities,
} from '@/lib/watchlists/import-export'

describe('watchlist import/export', () => {
  it('extracts listing identities from watchlist items only', () => {
    const listings = extractWatchlistListingIdentities([
      {
        id: 'one',
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'two',
        type: 'section',
        label: 'Tech',
      },
      {
        id: 'three',
        type: 'listing',
        listing: {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USDT',
          listing_type: 'crypto',
        },
      },
    ])

    expect(listings).toEqual([
      {
        listing_id: 'aapl-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USDT',
        listing_type: 'crypto',
      },
    ])
  })

  it('exports listing identities as JSON array payload', () => {
    const payload = exportWatchlistItemsAsJson([
      {
        id: 'one',
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'two',
        type: 'listing',
        listing: {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USDT',
          listing_type: 'crypto',
        },
      },
    ])

    expect(JSON.parse(payload)).toEqual([
      {
        listing_id: 'aapl-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USDT',
        listing_type: 'crypto',
      },
    ])
  })
})
