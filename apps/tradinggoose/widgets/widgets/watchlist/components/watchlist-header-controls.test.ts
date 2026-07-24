import { describe, expect, it } from 'vitest'
import { resolveNextSectionName } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

describe('watchlist header naming helpers', () => {
  it('resolves the next available section number from existing sections only', () => {
    expect(
      resolveNextSectionName({
        items: [
          {
            id: 'section-1',
            type: 'section',
            parentId: null,
            label: 'Section 1',
          },
          {
            id: 'listing-1',
            type: 'listing',
            parentId: null,
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
            parentId: null,
            label: 'Section 3',
          },
          {
            id: 'section-custom',
            type: 'section',
            parentId: null,
            label: 'Favorites',
          },
        ],
      })
    ).toBe('Section 2')
  })
})
