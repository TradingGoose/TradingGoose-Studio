export type ListingType = 'default' | 'crypto' | 'currency'

export type ListingIdentity = {
  listing_id: string
  base_id: string
  quote_id: string
  listing_type: ListingType
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
  value === 'default' || value === 'crypto' || value === 'currency'

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

export const toListingValueObject = (value: ListingInputValue): ListingIdentity | null => {
  if (!value) return null
  if (typeof value === 'string') return null

  return normalizeListingIdentity(value as Record<string, unknown>)
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

const normalizeListingIdentity = (
  record: Record<string, unknown>
): ListingIdentity | null => {
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
