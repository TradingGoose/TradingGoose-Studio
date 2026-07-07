import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingInputValue,
  type ListingResolved,
  toListingValueObject,
} from '@/lib/listing/identity'
import { resolveListingIdentities, resolveListingIdentity } from '@/lib/listing/resolve'
import {
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
} from '@/widgets/layout'

type ListingRecord = Record<string, unknown>
type ListingHydrationCache = Map<string, ListingResolved | null>

const readText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

const hasResolvedFields = (
  record: ListingRecord,
  listingType: 'default' | 'crypto' | 'currency'
): boolean => {
  const base = readText(record.base)
  if (!base) return false
  if (listingType !== 'default') {
    const quote = readText(record.quote)
    if (!quote) return false
  }
  return true
}

const mergeResolvedListing = (
  current: ListingRecord,
  resolved: ListingResolved
): ListingRecord => {
  const next: ListingRecord = { ...current }
  let changed = false

  const applyIfMissing = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    const existing = current[key]
    if (existing === undefined || existing === null || existing === '') {
      next[key] = value
      changed = true
    }
  }

  applyIfMissing('listing_id', resolved.listing_id)
  applyIfMissing('base_id', resolved.base_id)
  applyIfMissing('quote_id', resolved.quote_id)
  applyIfMissing('listing_type', resolved.listing_type)
  applyIfMissing('base', resolved.base)
  applyIfMissing('quote', resolved.quote)
  applyIfMissing('name', resolved.name)
  applyIfMissing('iconUrl', resolved.iconUrl)
  applyIfMissing('assetClass', resolved.assetClass)
  applyIfMissing('base_asset_class', resolved.base_asset_class)
  applyIfMissing('quote_asset_class', resolved.quote_asset_class)
  applyIfMissing('primaryMicCode', resolved.primaryMicCode)
  applyIfMissing('marketCode', resolved.marketCode)
  applyIfMissing('countryCode', resolved.countryCode)
  applyIfMissing('cityName', resolved.cityName)
  applyIfMissing('timeZoneName', resolved.timeZoneName)

  return changed ? next : current
}

const resolveListingValue = async (
  value: unknown,
  cache: ListingHydrationCache
): Promise<unknown> => {
  if (!value) return value
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return value

  const record = value as ListingRecord
  const listingIdentity = toListingValueObject(record as ListingInputValue)
  if (!listingIdentity) return value
  if (hasResolvedFields(record, listingIdentity.listing_type)) return value

  const key = getListingIdentityKey(listingIdentity)
  if (!cache.has(key)) {
    const resolved = await resolveListingIdentity(listingIdentity).catch(
      () => null
    )
    cache.set(key, resolved ?? null)
  }
  const resolved = cache.get(key)
  if (!resolved) return value

  return mergeResolvedListing(record, resolved)
}

export function collectDashboardListingIdentities(
  layoutState: unknown,
  colorPairsState: unknown
): ListingIdentity[] {
  const identities = new Map<string, ListingIdentity>()
  const collect = (value: unknown) => {
    const listing = toListingValueObject(value as ListingInputValue)
    if (!listing) return
    identities.set(getListingIdentityKey(listing), listing)
  }
  const walk = (node: LayoutNode) => {
    if (node.type === 'panel') {
      collect(
        node.widget?.params && typeof node.widget.params === 'object'
          ? (node.widget.params as { listing?: unknown }).listing
          : null
      )
      return
    }
    node.children.forEach(walk)
  }

  walk(normalizeDashboardLayout(layoutState))
  for (const pair of normalizeColorPairsState(colorPairsState).pairs) {
    collect(pair.listing)
  }
  return [...identities.values()]
}

function resolveListingValueFromMap(
  value: unknown,
  resolvedByKey: Record<string, ListingResolved | null>
): unknown {
  if (!value) return value
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return value

  const record = value as ListingRecord
  const listingIdentity = toListingValueObject(record as ListingInputValue)
  if (!listingIdentity) return value
  if (hasResolvedFields(record, listingIdentity.listing_type)) return value

  const resolved = resolvedByKey[getListingIdentityKey(listingIdentity)]
  return resolved ? mergeResolvedListing(record, resolved) : value
}

function hydrateLayoutListingsFromMap(
  layout: LayoutNode,
  resolvedByKey: Record<string, ListingResolved | null>
): LayoutNode {
  if (layout.type === 'panel') {
    const widget = layout.widget
    if (!widget || !widget.params || typeof widget.params !== 'object') return layout
    const listingValue = (widget.params as { listing?: unknown }).listing
    const resolved = resolveListingValueFromMap(listingValue, resolvedByKey)
    if (resolved === listingValue) return layout
    return {
      ...layout,
      widget: {
        ...widget,
        params: {
          ...(widget.params as Record<string, unknown>),
          listing: resolved ?? null,
        },
      },
    }
  }

  const children = layout.children.map((child) => hydrateLayoutListingsFromMap(child, resolvedByKey))
  return children.some((child, index) => child !== layout.children[index])
    ? { ...layout, children }
    : layout
}

function hydrateColorPairsListingsFromMap(
  state: PersistedColorPairsState,
  resolvedByKey: Record<string, ListingResolved | null>
): PersistedColorPairsState {
  let mutated = false
  const pairs = state.pairs.map((pair) => {
    const resolved = resolveListingValueFromMap(pair.listing, resolvedByKey)
    if (resolved === pair.listing) return pair
    mutated = true
    return { ...pair, listing: (resolved ?? null) as ListingIdentity | null }
  })
  return mutated ? { pairs } : state
}

export function applyResolvedDashboardListings(
  layoutState: unknown,
  colorPairsState: unknown,
  resolvedByKey: Record<string, ListingResolved | null>
): {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
} {
  const layout = normalizeDashboardLayout(layoutState)
  const colorPairs = normalizeColorPairsState(colorPairsState)
  return {
    layout: hydrateLayoutListingsFromMap(layout, resolvedByKey),
    colorPairs: hydrateColorPairsListingsFromMap(colorPairs, resolvedByKey),
  }
}

export async function hydrateDashboardListingData(
  layoutState: unknown,
  colorPairsState: unknown
): Promise<{
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
}> {
  const resolvedByKey = await resolveListingIdentities(
    collectDashboardListingIdentities(layoutState, colorPairsState)
  ).catch(() => ({}))
  return applyResolvedDashboardListings(layoutState, colorPairsState, resolvedByKey)
}

export async function hydrateListingUI(
  blocks: Record<string, any>
): Promise<Record<string, any>> {
  const cache: ListingHydrationCache = new Map()
  let mutatedBlocks = false
  const nextBlocks: Record<string, any> = { ...blocks }

  const blockEntries = Object.entries(blocks)
  for (const [blockId, block] of blockEntries) {
    if (!block || typeof block !== 'object') continue
    const subBlocks = block.subBlocks
    if (!subBlocks || typeof subBlocks !== 'object') continue

    let blockChanged = false
    const nextSubBlocks: Record<string, any> = { ...subBlocks }

    const subBlockEntries = Object.entries(subBlocks)
    for (const [subBlockId, subBlock] of subBlockEntries) {
      if (!subBlock || typeof subBlock !== 'object') continue
      const value = (subBlock as { value?: unknown }).value
      const resolvedValue = await resolveListingValue(value, cache)
      if (resolvedValue !== value) {
        blockChanged = true
        nextSubBlocks[subBlockId] = {
          ...subBlock,
          value: resolvedValue,
        }
      }
    }

    if (blockChanged) {
      mutatedBlocks = true
      nextBlocks[blockId] = {
        ...block,
        subBlocks: nextSubBlocks,
      }
    }
  }

  return mutatedBlocks ? nextBlocks : blocks
}
