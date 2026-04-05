import type { ListingOption } from '@/lib/listing/identity'

export const PREFERRED_MARKET_CODES = [
  'NASDAQ',
  'HKEX',
  'LSE',
  'NYSE',
  'SHE'
] as const

const PREFERRED_MARKET_CODE_SET = new Set<string>(PREFERRED_MARKET_CODES)

export function filterToPreferredMarkets(listings: ListingOption[]): ListingOption[] {
  return listings.filter((listing) => {
    const marketCode = listing.marketCode?.trim().toUpperCase()
    return marketCode != null && PREFERRED_MARKET_CODE_SET.has(marketCode)
  })
}

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
