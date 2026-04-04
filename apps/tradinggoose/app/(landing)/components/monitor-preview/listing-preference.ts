import type { ListingOption } from '@/lib/listing/identity'

const PREFERRED_MARKET_CODES = [
  'NASDAQ',
  'NYSE',
  'NYMEX',
  'HKEX',
  'SHE',
  'SHG',
  'LSE',
  'BVC',
] as const

const PREFERRED_MARKET_RANK = new Map<string, number>(PREFERRED_MARKET_CODES.map((code, index) => [code, index]))

function getPreferredMarketRank(listing: ListingOption): number {
  const marketCode = listing.marketCode?.trim().toUpperCase()
  return marketCode == null
    ? Number.POSITIVE_INFINITY
    : (PREFERRED_MARKET_RANK.get(marketCode) ?? Number.POSITIVE_INFINITY)
}

export function sortMonitorListings(listings: ListingOption[]): ListingOption[] {
  return [...listings].sort(
    (left, right) => getPreferredMarketRank(left) - getPreferredMarketRank(right)
  )
}
