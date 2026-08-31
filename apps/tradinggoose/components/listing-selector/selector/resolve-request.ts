import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'

export async function requestListingResolution(
  listing: ListingIdentity,
  signal?: AbortSignal
): Promise<ListingResolved | null> {
  return resolveListingIdentity(listing, signal)
}
