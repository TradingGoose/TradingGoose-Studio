import { resolveListingIdentity } from '@/lib/listing/resolve'
import {
  resolveListingKey,
  toListingValueObject,
  type ListingResolved,
} from '@/lib/listing/identity'

type ListingRecord = Record<string, unknown>

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
  listingType: 'equity' | 'crypto' | 'currency'
): boolean => {
  const base = readText(record.base)
  if (!base) return false
  if (listingType !== 'equity') {
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

  applyIfMissing('id', resolved.id)
  applyIfMissing('equity_id', resolved.equity_id)
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
  applyIfMissing('countryCode', resolved.countryCode)
  applyIfMissing('cityName', resolved.cityName)
  applyIfMissing('timeZoneName', resolved.timeZoneName)

  return changed ? next : current
}

export async function hydrateListingUI(
  blocks: Record<string, any>
): Promise<Record<string, any>> {
  const cache = new Map<string, ListingResolved | null>()
  let mutatedBlocks = false
  const nextBlocks: Record<string, any> = { ...blocks }

  const resolveListingValue = async (value: unknown): Promise<unknown> => {
    if (!value || typeof value !== 'object') return value
    const record = value as ListingRecord
    const listingIdentity = toListingValueObject(record)
    if (!listingIdentity) return value
    if (hasResolvedFields(record, listingIdentity.listing_type)) return value

    const key = resolveListingKey(listingIdentity)
    if (!key) return value
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached ? mergeResolvedListing(record, cached) : value
    }

    const resolved = await resolveListingIdentity(listingIdentity).catch(() => null)
    cache.set(key, resolved ?? null)
    if (!resolved) return value
    return mergeResolvedListing(record, resolved)
  }

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
      const resolvedValue = await resolveListingValue(value)
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
