import { describe, expect, it } from 'vitest'
import {
  buildHeatmapTreemapLayout,
  type HeatmapTreemapLeafNode,
  type HeatmapTreemapNode,
} from '@/widgets/widgets/heatmap/utils/treemap-layout'

const collectLeafNodes = (node: HeatmapTreemapNode | null): HeatmapTreemapLeafNode[] => {
  if (!node) return []
  if (node.type === 'leaf') return [node]
  return node.children.flatMap((child) => collectLeafNodes(child))
}

describe('buildHeatmapTreemapLayout', () => {
  it('builds bounded resizable treemap leaves for listing identities', () => {
    const layout = buildHeatmapTreemapLayout({
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
    const leaves = collectLeafNodes(layout)

    expect(layout?.type).toBe('group')
    expect(leaves).toHaveLength(2)
    expect(leaves[0]?.tile.label).toBe('AAPL')
    for (const leaf of leaves) {
      expect(leaf.width).toBeGreaterThan(0)
      expect(leaf.height).toBeGreaterThan(0)
      expect(leaf.width).toBeLessThanOrEqual(320)
      expect(leaf.height).toBeLessThanOrEqual(180)
    }
  })

  it('uses positive size values for relative tile area', () => {
    const layout = buildHeatmapTreemapLayout({
      width: 300,
      height: 100,
      items: [
        {
          key: 'default|AAPL||',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
          sizeValue: 9,
        },
        {
          key: 'default|MSFT||',
          listing: {
            listing_id: 'MSFT',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
          sizeValue: 1,
        },
      ],
    })
    const leaves = collectLeafNodes(layout)

    const apple = leaves.find((leaf) => leaf.tile.key === 'default|AAPL||')
    const microsoft = leaves.find((leaf) => leaf.tile.key === 'default|MSFT||')

    expect(apple?.tile.value).toBe(9)
    expect(microsoft?.tile.value).toBe(1)
    expect((apple?.width ?? 0) * (apple?.height ?? 0)).toBeGreaterThan(
      (microsoft?.width ?? 0) * (microsoft?.height ?? 0)
    )
  })
})
