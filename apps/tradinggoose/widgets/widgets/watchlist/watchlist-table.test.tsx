import { describe, expect, it } from 'vitest'
import {
  resolveWatchlistAssetClass,
  resolveWatchlistListingLabel,
  resolveWatchlistValueColorClass,
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
})
