import type { ListingOption, ListingResolved } from '@/lib/listing/identity'

export type ListingSymbolParts = {
  base: string
  quote: string
}

export const hasListingDetails = (listing?: ListingResolved | null): boolean => {
  if (!listing) return false
  const base = listing.base?.trim()
  const name = listing.name?.trim()
  if (listing.listing_type === 'default') {
    return Boolean(base || name)
  }
  const quote = listing.quote?.trim()
  return Boolean((base && quote) || name)
}

export const getListingSymbol = (listing: ListingResolved): string => {
  const base = listing.base?.trim()
  const quote = listing.quote?.trim()
  if (base) {
    return quote ? `${base}/${quote}` : base
  }
  const name = listing.name?.trim()
  if (name) return name
  return ''
}

export const splitListingSymbol = (symbol: string): ListingSymbolParts => {
  if (symbol.includes('/')) {
    const [rawBase, rawQuote] = symbol.split('/')
    return { base: rawBase?.trim() ?? symbol, quote: rawQuote?.trim() ?? '' }
  }
  if (symbol.includes(':')) {
    const [rawBase, rawQuote] = symbol.split(':')
    return { base: rawBase?.trim() ?? symbol, quote: rawQuote?.trim() ?? '' }
  }
  return { base: symbol, quote: '' }
}

export const buildListingDisplay = (listing: ListingOption | null) => {
  const listingSymbol = listing ? getListingSymbol(listing) : 'Symbol'
  const base = listing?.base?.trim() ?? ''
  const quote = listing?.quote?.trim() ?? ''
  const listingSymbolParts = base ? { base, quote } : splitListingSymbol(listingSymbol)
  const listingSymbolText = listingSymbolParts.quote
    ? `${listingSymbolParts.base}/${listingSymbolParts.quote}`
    : listingSymbolParts.base
  const listingName = listing?.name?.trim() ?? ''

  return {
    listingSymbol,
    listingSymbolParts,
    listingSymbolText,
    listingName,
  }
}

export const getListingFallback = (symbol: string): string => symbol.slice(0, 2).toUpperCase()

export const getFlagData = (
  countryCode?: string | null
): { emoji: string; codepoints: string } | null => {
  if (!countryCode) return null
  const code = countryCode.trim().toUpperCase()
  if (code.length !== 2) return null
  const flagOffset = 0x1f1e6
  const asciiOffset = 0x41
  const first = code.codePointAt(0)
  const second = code.codePointAt(1)
  if (first == null || second == null) return null
  if (first < asciiOffset || first > asciiOffset + 25) return null
  if (second < asciiOffset || second > asciiOffset + 25) return null
  const firstChar = first - asciiOffset + flagOffset
  const secondChar = second - asciiOffset + flagOffset
  return {
    emoji: String.fromCodePoint(firstChar, secondChar),
    codepoints: `${firstChar.toString(16)}-${secondChar.toString(16)}`,
  }
}
