import type { ListingOption } from '@/stores/market/selector/store'

export type ListingValueObject = {
  equity_id?: string | null
  base_id?: string | null
  quote_id?: string | null
  base_asset_class?: string | null
  quote_asset_class?: string | null
}

export type ListingValue = ListingValueObject | string | null | undefined

const readListingField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value)
  }
  return undefined
}

export const resolveListingId = (value: ListingValue): string | undefined => {
  if (!value) return undefined
  if (typeof value === 'string') return value

  const record = value as Record<string, unknown>
  const equityId = readListingField(record, 'equity_id') ?? readListingField(record, 'listing_id')
  if (equityId) return equityId

  const baseId = readListingField(record, 'base_id')
  const quoteId = readListingField(record, 'quote_id')

  if (baseId && quoteId) {
    return `${baseId}:${quoteId}`
  }

  return undefined
}

export const toListingValue = (
  listing: ListingOption | null | undefined
): ListingValueObject | null => {
  if (!listing) return null

  const resolvedEquityId =
    listing.equity_id ??
    (listing.base_id && listing.quote_id ? null : listing.id ?? null)

  return {
    equity_id: resolvedEquityId,
    base_id: listing.base_id ?? null,
    quote_id: listing.quote_id ?? null,
    base_asset_class: listing.base_asset_class ?? null,
    quote_asset_class: listing.quote_asset_class ?? null,
  }
}

export const toListingValueObject = (value: ListingValue): ListingValueObject | null => {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.includes(':')) {
      const [baseId, quoteId] = trimmed.split(':')
      return {
        equity_id: null,
        base_id: baseId?.trim() || null,
        quote_id: quoteId?.trim() || null,
        base_asset_class: null,
        quote_asset_class: null,
      }
    }
    return {
      equity_id: trimmed,
      base_id: null,
      quote_id: null,
      base_asset_class: null,
      quote_asset_class: null,
    }
  }

  const record = value as Record<string, unknown>
  const equityId = readListingField(record, 'equity_id') ?? readListingField(record, 'listing_id')
  const baseId = readListingField(record, 'base_id')
  const quoteId = readListingField(record, 'quote_id')
  const baseAssetClass = readListingField(record, 'base_asset_class')
  const quoteAssetClass = readListingField(record, 'quote_asset_class')
  return {
    equity_id: equityId ?? null,
    base_id: baseId ?? null,
    quote_id: quoteId ?? null,
    base_asset_class: baseAssetClass ?? null,
    quote_asset_class: quoteAssetClass ?? null,
  }
}
