import { z } from 'zod'
import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import {
  getListingIdentityKey,
  ListingIdentitySchema,
  toListingValueObject,
} from '@/lib/listing/identity'
import { MAX_SYMBOLS_PER_WATCHLIST } from '@/lib/watchlists/constants'
import type {
  WatchlistDocumentFields,
  WatchlistDocumentInputContent,
  WatchlistDocumentInputFields,
  WatchlistDocumentInputItem,
  WatchlistDocumentListingInputItem,
  WatchlistDocumentSectionInputItem,
  WatchlistItem,
  WatchlistSettings,
} from '@/lib/watchlists/types'

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const watchlistDocumentKeys = new Set(['name', 'settings', 'items'])
const watchlistContentKeys = new Set(['settings', 'items'])

export const WatchlistSettingsSchema = z
  .object({
    showLogo: z.boolean(),
    showTicker: z.boolean(),
    showDescription: z.boolean(),
  })
  .strict()

export const WatchlistDocumentListingItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('listing'),
    parentId: z.string().trim().min(1).nullable().optional(),
    listing: ListingIdentitySchema,
  })
  .strict()

export const WatchlistDocumentSectionItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('section'),
    parentId: z.null().optional(),
    label: z.string().trim().min(1, 'Section label is required'),
  })
  .strict()

export const WatchlistDocumentItemSchema = z.union([
  WatchlistDocumentListingItemSchema,
  WatchlistDocumentSectionItemSchema,
])

const canonicalYjsString = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'Value must not contain surrounding whitespace')

export const WatchlistYjsItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: z.string().uuid(),
      type: z.literal('listing'),
      parentId: canonicalYjsString.nullable(),
      listing: ListingIdentitySchema,
      order: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('section'),
      parentId: z.null(),
      label: canonicalYjsString,
      order: z.number().finite(),
    })
    .strict(),
])

export const WatchlistContentDocumentSchema = z
  .object({
    settings: WatchlistSettingsSchema,
    items: z.array(WatchlistDocumentItemSchema),
  })
  .strict()

export const WatchlistDocumentSchema = WatchlistContentDocumentSchema.extend({
  name: z.string().trim().min(1, 'Watchlist name is required'),
}).strict()

export class WatchlistDocumentError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'WatchlistDocumentError'
  }
}

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

export const normalizeWatchlistName = (value: unknown): string => {
  const normalized = normalizeString(value)
  if (!normalized) {
    throw new Error('Watchlist name is required')
  }
  return normalized
}

export const normalizeWatchlistSettings = (value: unknown): WatchlistSettings => {
  if (!isPlainRecord(value)) {
    throw new Error('Watchlist settings are required')
  }

  const { showLogo, showTicker, showDescription } = value
  if (
    typeof showLogo !== 'boolean' ||
    typeof showTicker !== 'boolean' ||
    typeof showDescription !== 'boolean'
  ) {
    throw new Error('Watchlist settings must include showLogo, showTicker, and showDescription')
  }

  return {
    showLogo,
    showTicker,
    showDescription,
  }
}

const normalizeListingIdentity = (value: unknown): ListingIdentity | null => {
  if (!isPlainRecord(value)) return null
  return toListingValueObject(value as ListingInputValue) ?? null
}

const normalizeOptionalId = (value: unknown): string | undefined => {
  const id = normalizeString(value)
  return id || undefined
}

const normalizeNullableParentId = (value: unknown): string | null => {
  if (value == null) return null
  const id = normalizeString(value)
  return id || null
}

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: Set<string>) =>
  Object.keys(value).every((key) => allowedKeys.has(key))

const listingItemKeys = new Set(['id', 'type', 'parentId', 'listing'])
const containerItemKeys = new Set(['id', 'type', 'parentId', 'label'])

export const watchlistListingMembershipKey = (
  parentId: string | null | undefined,
  listing: ListingIdentity
) => `listing:${parentId ?? '__root__'}:${getListingIdentityKey(listing)}`

const normalizeWatchlistDocumentListingInputItem = (
  value: unknown
): WatchlistDocumentListingInputItem | null => {
  if (!isPlainRecord(value)) return null
  if (normalizeString(value.type) !== 'listing') return null
  if (!hasOnlyKeys(value, listingItemKeys)) return null

  const listing = normalizeListingIdentity(value.listing)
  if (!listing) return null

  return {
    ...(normalizeOptionalId(value.id) ? { id: normalizeOptionalId(value.id) } : {}),
    type: 'listing',
    parentId: normalizeNullableParentId(value.parentId),
    listing,
  }
}

const normalizeWatchlistDocumentInputItem = (value: unknown): WatchlistDocumentInputItem | null => {
  if (!isPlainRecord(value)) return null

  const type = normalizeString(value.type)
  if (type === 'listing') {
    return normalizeWatchlistDocumentListingInputItem(value)
  }

  if (type !== 'section') return null
  if (!hasOnlyKeys(value, containerItemKeys)) return null

  const label = normalizeString(value.label)
  if (!label) return null
  if (value.parentId !== undefined && value.parentId !== null) {
    throw new WatchlistDocumentError('Watchlist sections cannot have parentId')
  }

  return {
    ...(normalizeOptionalId(value.id) ? { id: normalizeOptionalId(value.id) } : {}),
    type: 'section',
    parentId: null,
    label,
  } satisfies WatchlistDocumentSectionInputItem
}

const normalizeWatchlistItem = (value: unknown): WatchlistItem | null => {
  if (!isPlainRecord(value)) return null
  const id = normalizeString(value.id)
  if (!id) return null

  const type = normalizeString(value.type)
  if (type === 'section') {
    if (!hasOnlyKeys(value, containerItemKeys)) return null
    const label = normalizeString(value.label)
    if (!label) return null
    if (value.parentId !== undefined && value.parentId !== null) {
      throw new WatchlistDocumentError('Watchlist sections cannot have parentId')
    }
    return {
      id,
      type: 'section',
      parentId: null,
      label,
    }
  }

  if (type === 'listing') {
    if (!hasOnlyKeys(value, listingItemKeys)) return null
    const listing = normalizeListingIdentity(value.listing)
    if (!listing) return null
    return {
      id,
      type: 'listing',
      parentId: normalizeNullableParentId(value.parentId),
      listing,
    }
  }

  return null
}

export const normalizeWatchlistItems = (value: unknown): WatchlistItem[] => {
  if (!Array.isArray(value)) return []
  const normalized: WatchlistItem[] = []
  for (const entry of value) {
    const item = normalizeWatchlistItem(entry)
    if (!item) continue
    normalized.push(item)
  }
  return normalized
}

export const normalizeWatchlistDocumentInputItems = (
  value: unknown
): WatchlistDocumentInputItem[] => {
  if (!Array.isArray(value)) return []

  const normalized: WatchlistDocumentInputItem[] = []
  for (const entry of value) {
    const item = normalizeWatchlistDocumentInputItem(entry)
    if (!item) continue
    normalized.push(item)
  }

  return normalized
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assignWatchlistDocumentItemIds(
  items: WatchlistDocumentInputItem[],
  preserveUuids: boolean
): WatchlistItem[] {
  const resolvedIds = new Map<string, string>()
  for (const item of items) {
    if (item.id) {
      resolvedIds.set(
        item.id,
        preserveUuids && UUID_PATTERN.test(item.id) ? item.id : crypto.randomUUID()
      )
    }
  }

  return items.map((item) => {
    const id = item.id ? (resolvedIds.get(item.id) as string) : crypto.randomUUID()
    if (item.type === 'section') return { ...item, id, parentId: null }
    return {
      ...item,
      id,
      parentId: item.parentId ? (resolvedIds.get(item.parentId) ?? item.parentId) : null,
    }
  })
}

export const resolveWatchlistDocumentItemIds = (items: WatchlistDocumentInputItem[]) =>
  assignWatchlistDocumentItemIds(items, true)

export const remapImportedWatchlistDocumentItemIds = (items: WatchlistDocumentInputItem[]) =>
  assignWatchlistDocumentItemIds(items, false)

function assertNoDuplicateSubmittedIds(items: Array<{ id?: string }>): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.id) continue
    if (seen.has(item.id)) {
      throw new WatchlistDocumentError('Watchlist document contains duplicate item ids')
    }
    seen.add(item.id)
  }
}

function assertNoDuplicateListings(
  items: Array<{
    type: string
    parentId?: string | null
    listing?: ListingIdentity
  }>
): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.type !== 'listing' || !item.listing) continue
    const key = watchlistListingMembershipKey(item.parentId, item.listing)
    if (seen.has(key)) {
      throw new WatchlistDocumentError('Listing already exists in watchlist', 409)
    }
    seen.add(key)
  }
}

export function assertValidParentTree(
  items: Array<{ id?: string; type: string; parentId?: string | null }>
) {
  const sectionIds = new Set<string>()

  for (const item of items) {
    if (item.type !== 'section') continue
    if (item.parentId != null) {
      throw new WatchlistDocumentError('Watchlist sections cannot have parentId')
    }
    if (item.id) sectionIds.add(item.id)
  }

  for (const item of items) {
    if (item.type !== 'listing') continue
    const parentId = item.parentId ?? null
    if (!parentId) continue
    if (!sectionIds.has(parentId)) {
      throw new WatchlistDocumentError('Watchlist item parentId must reference a section')
    }
  }
}

function assertWatchlistDocumentSymbolLimit(items: ReadonlyArray<{ type: string }>): void {
  if (items.filter((item) => item.type === 'listing').length > MAX_SYMBOLS_PER_WATCHLIST) {
    throw new WatchlistDocumentError(
      `Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`
    )
  }
}

function assertOnlyWatchlistDocumentKeys(source: Record<string, unknown>): void {
  const unexpectedKey = Object.keys(source).find((key) => !watchlistDocumentKeys.has(key))
  if (unexpectedKey) {
    throw new WatchlistDocumentError(`Unsupported watchlist document field: ${unexpectedKey}`)
  }
}

function assertOnlyWatchlistContentKeys(source: Record<string, unknown>): void {
  const unexpectedKey = Object.keys(source).find((key) => !watchlistContentKeys.has(key))
  if (unexpectedKey) {
    throw new WatchlistDocumentError(`Unsupported watchlist content field: ${unexpectedKey}`)
  }
}

function requireWatchlistDocumentRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new WatchlistDocumentError('Watchlist document fields must be an object')
  }
  return value
}

function normalizeInputItems(value: unknown): WatchlistDocumentInputItem[] {
  if (!Array.isArray(value)) {
    throw new WatchlistDocumentError('Watchlist items must be an array')
  }

  const normalized = normalizeWatchlistDocumentInputItems(value)
  if (normalized.length !== value.length) {
    throw new WatchlistDocumentError('Invalid watchlist item')
  }

  assertNoDuplicateSubmittedIds(normalized)
  assertNoDuplicateListings(normalized)
  assertValidParentTree(normalized)
  assertWatchlistDocumentSymbolLimit(normalized)
  return normalized
}

export function normalizeWatchlistDocumentFields(value: unknown): WatchlistDocumentInputFields {
  const source = requireWatchlistDocumentRecord(value)
  assertOnlyWatchlistDocumentKeys(source)
  return {
    name: normalizeWatchlistName(source.name),
    settings: normalizeWatchlistSettings(source.settings),
    items: normalizeInputItems(source.items),
  }
}

export function normalizeWatchlistDocumentContent(value: unknown): WatchlistDocumentInputContent {
  const source = requireWatchlistDocumentRecord(value)
  assertOnlyWatchlistContentKeys(source)
  return {
    settings: normalizeWatchlistSettings(source.settings),
    items: normalizeInputItems(source.items),
  }
}

export function normalizePersistedWatchlistDocumentFields(value: unknown): WatchlistDocumentFields {
  const source = requireWatchlistDocumentRecord(value)
  assertOnlyWatchlistDocumentKeys(source)
  const name = normalizeWatchlistName(source.name)
  const settings = normalizeWatchlistSettings(source.settings)
  if (!Array.isArray(source.items)) {
    throw new WatchlistDocumentError('Watchlist items must be an array')
  }
  const items = normalizeWatchlistItems(source.items)

  if (items.length !== source.items.length) {
    throw new WatchlistDocumentError('Invalid persisted watchlist item')
  }

  assertNoDuplicateSubmittedIds(items)
  assertNoDuplicateListings(items)
  assertValidParentTree(items)
  assertWatchlistDocumentSymbolLimit(items)

  return { name, settings, items }
}
