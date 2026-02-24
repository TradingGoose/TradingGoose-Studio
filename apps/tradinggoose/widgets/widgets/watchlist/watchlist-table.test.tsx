import { describe, expect, it } from 'vitest'
import type { WatchlistSort } from '@/lib/watchlists/types'
import type { WatchlistQuoteSnapshot } from '@/hooks/queries/watchlist-quotes'
import {
  resolveWatchlistAssetClass,
  resolveWatchlistListingLabel,
  resolveWatchlistValueColorClass,
  sortWatchlistRowsByColumn,
} from '@/widgets/widgets/watchlist/components/watchlist-table-utils'

describe('watchlist table utils', () => {
  it('resolves color classes for positive, negative, and neutral values', () => {
    expect(resolveWatchlistValueColorClass(2)).toBe('text-green-600')
    expect(resolveWatchlistValueColorClass(-1)).toBe('text-red-600')
    expect(resolveWatchlistValueColorClass(0)).toBe('text-foreground')
    expect(resolveWatchlistValueColorClass(null)).toBe('text-muted-foreground')
  })

  it('resolves listing labels and asset classes from listing identity', () => {
    expect(
      resolveWatchlistListingLabel(
        {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USDT',
          listing_type: 'crypto',
        },
        null
      )
    ).toBe('BTC/USDT')

    expect(
      resolveWatchlistAssetClass(
        {
          listing_id: '',
          base_id: 'EUR',
          quote_id: 'USD',
          listing_type: 'currency',
        },
        null
      )
    ).toBe('CURRENCY')
  })

  it('sorts watchlist rows by numeric columns', () => {
    const rows = [
      {
        item: {
          id: 'a',
          type: 'listing' as const,
          listing: {
            listing_id: 'a',
            base_id: '',
            quote_id: '',
            listing_type: 'default' as const,
          },
        },
        listing: {
          listing_id: 'a',
          base_id: '',
          quote_id: '',
          listing_type: 'default' as const,
        },
        key: 'a',
      },
      {
        item: {
          id: 'b',
          type: 'listing' as const,
          listing: {
            listing_id: 'b',
            base_id: '',
            quote_id: '',
            listing_type: 'default' as const,
          },
        },
        listing: {
          listing_id: 'b',
          base_id: '',
          quote_id: '',
          listing_type: 'default' as const,
        },
        key: 'b',
      },
    ]

    const quotes: Record<string, WatchlistQuoteSnapshot> = {
      a: {
        lastPrice: 10,
        change: 1,
        changePercent: 10,
        previousClose: 9,
      },
      b: {
        lastPrice: 20,
        change: 2,
        changePercent: 11,
        previousClose: 19,
      },
    }
    const sort: WatchlistSort = {
      column: 'lastPrice',
      direction: 'desc',
    }

    const sorted = sortWatchlistRowsByColumn(rows, sort, quotes, {})
    expect(sorted.map((entry) => entry.key)).toEqual(['b', 'a'])
  })
})
