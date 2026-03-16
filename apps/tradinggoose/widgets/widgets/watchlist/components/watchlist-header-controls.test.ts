import { describe, expect, it } from 'vitest'
import {
  resolveNextSectionName,
  resolveNextWatchlistName,
} from '@/widgets/widgets/watchlist/components/watchlist-header-controls'
import { resolveWatchlistProviderCredentialDefinitions } from '@/widgets/widgets/watchlist/components/provider-controls'

describe('watchlist header naming helpers', () => {
  it('resolves the next available watchlist number', () => {
    expect(
      resolveNextWatchlistName([
        { name: 'Favorites' },
        { name: 'Watchlist 1' },
        { name: 'Watchlist 3' },
      ])
    ).toBe('Watchlist 2')
  })

  it('resolves the next available section number from existing sections only', () => {
    expect(
      resolveNextSectionName({
        items: [
          {
            id: 'section-1',
            type: 'section',
            label: 'Section 1',
          },
          {
            id: 'listing-1',
            type: 'listing',
            listing: {
              listing_id: 'BTC',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
          {
            id: 'section-3',
            type: 'section',
            label: 'Section 3',
          },
          {
            id: 'section-custom',
            type: 'section',
            label: 'Favorites',
          },
        ],
      })
    ).toBe('Section 2')
  })

  it('keeps only credential fields for watchlist provider settings', () => {
    expect(
      resolveWatchlistProviderCredentialDefinitions('alpaca').map((definition) => definition.id)
    ).toEqual(['apiKey', 'apiSecret'])
    expect(
      resolveWatchlistProviderCredentialDefinitions('finnhub').map((definition) => definition.id)
    ).toEqual(['apiKey'])
    expect(resolveWatchlistProviderCredentialDefinitions('yahoo-finance')).toEqual([])
  })
})
