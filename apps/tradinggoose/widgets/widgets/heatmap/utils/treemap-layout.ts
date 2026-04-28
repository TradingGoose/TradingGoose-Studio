import { hierarchy, treemap } from 'd3-hierarchy'
import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { getListingIdentityKey } from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshots'

export type HeatmapTreemapInputItem = {
  key: string
  listing: ListingIdentity
  resolvedListing?: ListingResolved | null
  quote?: MarketQuoteSnapshot | null
  sourceLabels?: string[]
}

export type HeatmapTreemapLayoutItem = HeatmapTreemapInputItem & {
  key: string
  label: string
  name: string
  value: number
  x: number
  y: number
  width: number
  height: number
}

type LayoutNode = HeatmapTreemapInputItem & {
  key: string
  label: string
  name: string
  value: number
}

const resolveTileLabel = (item: HeatmapTreemapInputItem) => {
  if (item.resolvedListing?.base) return item.resolvedListing.base
  if (item.listing.listing_type === 'default') return item.listing.listing_id
  return item.listing.quote_id
    ? `${item.listing.base_id}/${item.listing.quote_id}`
    : item.listing.base_id
}

export const computeHeatmapTreemapLayout = ({
  items,
  width,
  height,
}: {
  items: HeatmapTreemapInputItem[]
  width: number
  height: number
}): HeatmapTreemapLayoutItem[] => {
  if (width <= 0 || height <= 0 || items.length === 0) return []

  const children: LayoutNode[] = items.map((item) => {
    const key = item.key || getListingIdentityKey(item.listing)
    const label = resolveTileLabel(item)
    return {
      ...item,
      key,
      label,
      name: item.resolvedListing?.name ?? label,
      value: 1,
    }
  })

  const root = hierarchy<{ children: LayoutNode[] } | LayoutNode>({ children }).sum((node) =>
    'value' in node ? node.value : 0
  )

  treemap<{ children: LayoutNode[] } | LayoutNode>()
    .size([width, height])
    .paddingInner(2)
    .round(true)(root)

  return root
    .leaves()
    .map((leaf) => {
      const node = leaf.data as LayoutNode
      return {
        ...node,
        x: leaf.x0,
        y: leaf.y0,
        width: Math.max(0, leaf.x1 - leaf.x0),
        height: Math.max(0, leaf.y1 - leaf.y0),
      }
    })
    .filter((tile) => tile.width > 0 && tile.height > 0)
}
