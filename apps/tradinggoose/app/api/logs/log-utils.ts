import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'

/**
 * Parses a JSON-encoded listing filter string into a ListingIdentity.
 * Returns `undefined` when the input is empty/missing and `null` when parsing fails.
 */
export const parseListingFilter = (
  value: string | undefined
): ListingIdentity | undefined | null => {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return undefined

  try {
    const parsed = JSON.parse(normalized)
    return toListingValueObject(parsed)
  } catch {
    return null
  }
}
