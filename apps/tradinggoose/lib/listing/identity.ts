const LISTING_TYPES = ['default', 'crypto', 'currency'] as const

export type ListingType = (typeof LISTING_TYPES)[number]

export type ListingIdentity = {
  listing_id: string
  base_id: string
  quote_id: string
  listing_type: ListingType
}

export const LISTING_IDENTITY_VALUE_TYPE = 'listingIdentity' as const

export const LISTING_IDENTITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    listing_id: {
      type: 'string',
      description: 'Listing id for default listings; otherwise empty.',
    },
    base_id: { type: 'string', description: 'Base asset id for pair listings; otherwise empty.' },
    quote_id: { type: 'string', description: 'Quote asset id for pair listings; otherwise empty.' },
    listing_type: {
      type: 'string',
      enum: LISTING_TYPES,
      description: 'Listing type.',
    },
  },
  required: ['listing_id', 'base_id', 'quote_id', 'listing_type'],
  additionalProperties: false,
}

export type ListingResolved = ListingIdentity & {
  base: string
  quote?: string | null
  name?: string | null
  iconUrl?: string | null
  assetClass?: string | null
  primaryMicCode?: string | null
  marketCode?: string | null
  countryCode?: string | null
  cityName?: string | null
  timeZoneName?: string | null
  base_asset_class?: string | null
  quote_asset_class?: string | null
}

export type ListingOption = ListingResolved

export type ListingValue = ListingIdentity | null | undefined
export type ListingInputValue = ListingIdentity | ListingResolved | string | null | undefined

const readListingField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value)
  }
  return undefined
}

const isListingType = (value?: string | null): value is ListingType =>
  LISTING_TYPES.includes(value as ListingType)

const readListingType = (record: Record<string, unknown>): ListingType | undefined => {
  const raw = readListingField(record, 'listing_type')
  return isListingType(raw) ? raw : undefined
}

export const toListingValue = (
  listing: ListingOption | null | undefined
): ListingIdentity | null => {
  if (!listing) return null

  return normalizeListingIdentity(listing as Record<string, unknown>)
}

export const toListingValueObject = (value: unknown): ListingIdentity | null => {
  return normalizeListingIdentityValue(value)
}

export const areListingIdentitiesEqual = (
  left?: ListingIdentity | null,
  right?: ListingIdentity | null
) => {
  if (!left || !right) return false
  return (
    left.listing_type === right.listing_type &&
    left.listing_id === right.listing_id &&
    left.base_id === right.base_id &&
    left.quote_id === right.quote_id
  )
}

export const getListingIdentityKey = (listing: ListingIdentity) =>
  `${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`

const normalizeListingIdentityValue = (value: unknown): ListingIdentity | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return normalizeListingIdentity(value as Record<string, unknown>)
}

export const parseListingIdentityValueStrict = (value: unknown): ListingIdentity => {
  let parsedValue = value
  if (typeof value === 'string' && value.trim()) {
    try {
      parsedValue = JSON.parse(value.trim())
    } catch {
      throw new Error('Invalid listingIdentity value')
    }
  }
  const record =
    parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
      ? (parsedValue as Record<string, unknown>)
      : null
  const listing = record ? normalizeListingIdentity(record) : null

  if (
    !record ||
    !listing ||
    record.listing_id !== listing.listing_id ||
    record.base_id !== listing.base_id ||
    record.quote_id !== listing.quote_id ||
    record.listing_type !== listing.listing_type
  ) {
    throw new Error('Invalid listingIdentity value')
  }
  return listing
}

const normalizeListingIdentity = (record: Record<string, unknown>): ListingIdentity | null => {
  const listingType = readListingType(record)
  if (!listingType) return null

  const listingId = readListingField(record, 'listing_id') ?? ''
  const baseId = readListingField(record, 'base_id') ?? ''
  const quoteId = readListingField(record, 'quote_id') ?? ''

  if (listingType === 'default') {
    if (!listingId) return null
    return {
      listing_id: listingId,
      base_id: '',
      quote_id: '',
      listing_type: listingType,
    }
  }

  if (!baseId || !quoteId) return null

  return {
    listing_id: '',
    base_id: baseId,
    quote_id: quoteId,
    listing_type: listingType,
  }
}
