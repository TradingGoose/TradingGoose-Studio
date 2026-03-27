import { describe, expect, it } from 'vitest'
import {
  extractWatchlistImportFileItems,
  exportWatchlistItemsAsJson,
} from '@/lib/watchlists/import-export'

describe('watchlist import/export', () => {
  it('extracts hierarchical import file items without ids', () => {
    const items = extractWatchlistImportFileItems([
      {
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        type: 'section',
        label: 'Tech',
        items: [
          {
            type: 'listing',
            listing: {
              listing_id: '',
              base_id: 'BTC',
              quote_id: 'USDT',
              listing_type: 'crypto',
            },
          },
        ],
      },
    ])

    expect(items).toEqual([
      {
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        type: 'section',
        label: 'Tech',
        items: [
          {
            type: 'listing',
            listing: {
              listing_id: '',
              base_id: 'BTC',
              quote_id: 'USDT',
              listing_type: 'crypto',
            },
          },
        ],
      },
    ])
  })

  it('exports watchlist items as a hierarchical no-id JSON payload', () => {
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
        id: 'section-1',
        type: 'section',
        label: 'Tech',
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
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        type: 'section',
        label: 'Tech',
        items: [
          {
            type: 'listing',
            listing: {
              listing_id: '',
              base_id: 'BTC',
              quote_id: 'USDT',
              listing_type: 'crypto',
            },
          },
        ],
      },
    ])
  })
})
