import { describe, expect, it } from 'vitest'
import { computeHeatmapTreemapLayout } from '@/widgets/widgets/heatmap/utils/treemap-layout'

describe('computeHeatmapTreemapLayout', () => {
  it('builds bounded d3 treemap tiles for listing identities', () => {
    const tiles = computeHeatmapTreemapLayout({
      width: 320,
      height: 180,
      items: [
        {
          key: 'default|AAPL||',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
          resolvedListing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
            base: 'AAPL',
            name: 'Apple Inc.',
          },
        },
        {
          key: 'default|MSFT||',
          listing: {
            listing_id: 'MSFT',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    expect(tiles).toHaveLength(2)
    expect(tiles[0]?.label).toBe('AAPL')
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.y).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.width).toBeLessThanOrEqual(320)
      expect(tile.y + tile.height).toBeLessThanOrEqual(180)
    }
  })
})
