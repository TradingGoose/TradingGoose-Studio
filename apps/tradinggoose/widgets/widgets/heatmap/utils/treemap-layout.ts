import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { getListingIdentityKey } from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'

export type HeatmapTreemapInputItem = {
  key: string
  listing: ListingIdentity
  resolvedListing?: ListingResolved | null
  quote?: MarketQuoteSnapshot | null
  sizeValue?: number | null
  sourceLabels?: string[]
}

export type HeatmapTreemapTile = HeatmapTreemapInputItem & {
  key: string
  label: string
  name: string
  value: number
}

export type HeatmapTreemapLeafNode = {
  type: 'leaf'
  key: string
  value: number
  tile: HeatmapTreemapTile
  width: number
  height: number
}

export type HeatmapTreemapGroupNode = {
  type: 'group'
  key: string
  value: number
  direction: 'horizontal' | 'vertical'
  defaultSizes: [number, number]
  children: [HeatmapTreemapNode, HeatmapTreemapNode]
}

export type HeatmapTreemapNode = HeatmapTreemapLeafNode | HeatmapTreemapGroupNode

const resolveTileLabel = (item: HeatmapTreemapInputItem) => {
  if (item.resolvedListing?.base) return item.resolvedListing.base
  if (item.listing.listing_type === 'default') return item.listing.listing_id
  return item.listing.quote_id
    ? `${item.listing.base_id}/${item.listing.quote_id}`
    : item.listing.base_id
}

const resolveLayoutValue = (item: HeatmapTreemapInputItem) =>
  typeof item.sizeValue === 'number' && Number.isFinite(item.sizeValue) && item.sizeValue > 0
    ? item.sizeValue
    : 1

const sumTileValues = (tiles: HeatmapTreemapTile[]) =>
  tiles.reduce((total, tile) => total + tile.value, 0)

const findBalancedSplitIndex = (tiles: HeatmapTreemapTile[], totalValue: number) => {
  let runningValue = 0
  let splitIndex = 1
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 1; index < tiles.length; index += 1) {
    runningValue += tiles[index - 1]?.value ?? 0
    const distance = Math.abs(totalValue / 2 - runningValue)
    if (distance <= bestDistance) {
      bestDistance = distance
      splitIndex = index
    }
  }

  return splitIndex
}

const prepareHeatmapTreemapTiles = (items: HeatmapTreemapInputItem[]): HeatmapTreemapTile[] =>
  items
    .map((item, index) => {
      const key = item.key || getListingIdentityKey(item.listing)
      const label = resolveTileLabel(item)
      return {
        ...item,
        key,
        label,
        name: item.resolvedListing?.name ?? label,
        value: resolveLayoutValue(item),
        originalIndex: index,
      }
    })
    .sort((first, second) => {
      const valueDifference = second.value - first.value
      return valueDifference === 0 ? first.originalIndex - second.originalIndex : valueDifference
    })
    .map(({ originalIndex: _originalIndex, ...tile }) => tile)

const buildTreemapNode = ({
  tiles,
  width,
  height,
  path,
}: {
  tiles: HeatmapTreemapTile[]
  width: number
  height: number
  path: string
}): HeatmapTreemapNode => {
  const value = sumTileValues(tiles)

  if (tiles.length === 1) {
    const tile = tiles[0]
    return {
      type: 'leaf',
      key: tile.key,
      value: tile.value,
      tile,
      width,
      height,
    }
  }

  const splitIndex = findBalancedSplitIndex(tiles, value)
  const firstTiles = tiles.slice(0, splitIndex)
  const secondTiles = tiles.slice(splitIndex)
  const firstValue = sumTileValues(firstTiles)
  const secondValue = sumTileValues(secondTiles)
  const totalValue = firstValue + secondValue
  const firstSize = totalValue > 0 ? (firstValue / totalValue) * 100 : 50
  const secondSize = 100 - firstSize
  const direction = width >= height ? 'horizontal' : 'vertical'
  const firstWidth = direction === 'horizontal' ? (width * firstSize) / 100 : width
  const secondWidth = direction === 'horizontal' ? width - firstWidth : width
  const firstHeight = direction === 'vertical' ? (height * firstSize) / 100 : height
  const secondHeight = direction === 'vertical' ? height - firstHeight : height

  return {
    type: 'group',
    key: `heatmap-group-${path}-${direction}-${tiles.length}-${firstSize.toFixed(4)}-${secondSize.toFixed(4)}`,
    value,
    direction,
    defaultSizes: [firstSize, secondSize],
    children: [
      buildTreemapNode({
        tiles: firstTiles,
        width: firstWidth,
        height: firstHeight,
        path: `${path}-0`,
      }),
      buildTreemapNode({
        tiles: secondTiles,
        width: secondWidth,
        height: secondHeight,
        path: `${path}-1`,
      }),
    ],
  }
}

export const buildHeatmapTreemapLayout = ({
  items,
  width,
  height,
}: {
  items: HeatmapTreemapInputItem[]
  width: number
  height: number
}) => {
  if (width <= 0 || height <= 0 || items.length === 0) return null

  const tiles = prepareHeatmapTreemapTiles(items)
  if (tiles.length === 0) return null

  return buildTreemapNode({
    tiles,
    width,
    height,
    path: 'root',
  })
}
