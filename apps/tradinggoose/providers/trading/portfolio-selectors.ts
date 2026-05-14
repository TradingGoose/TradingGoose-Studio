import type { ListingIdentity } from '@/lib/listing/identity'
import { getListingIdentityKey, toListingValueObject } from '@/lib/listing/identity'
import type { PortfolioDetail } from '@/providers/trading/portfolio-identity'

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const getPortfolioListingExposures = (
  portfolioDetail: PortfolioDetail | null | undefined
): Array<{
  listing: ListingIdentity
  grossQuantity: number
  signedQuantity: number
}> => {
  if (!portfolioDetail) return []

  const listingsByKey = new Map<
    string,
    {
      listing: ListingIdentity
      grossQuantity: number
      signedQuantity: number
    }
  >()

  for (const position of portfolioDetail.positions) {
    const listing = toListingValueObject(position.symbol.listing)
    if (!listing) continue

    const key = getListingIdentityKey(listing)
    const multiplier = isFiniteNumber(position.multiplier) ? position.multiplier : 1
    const conversionRate = isFiniteNumber(position.conversionRate) ? position.conversionRate : 1
    const quantity = isFiniteNumber(position.quantity) ? position.quantity : 0
    const signedQuantity = quantity * multiplier * conversionRate
    const grossQuantity = Math.abs(signedQuantity)
    const current = listingsByKey.get(key)

    if (current) {
      current.grossQuantity += grossQuantity
      current.signedQuantity += signedQuantity
      continue
    }

    listingsByKey.set(key, {
      listing,
      grossQuantity,
      signedQuantity,
    })
  }

  return Array.from(listingsByKey.values())
}
