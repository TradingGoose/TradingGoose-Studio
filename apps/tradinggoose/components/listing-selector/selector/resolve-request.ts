import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import { resolveListingIdentity, type ResolvedListingDetails } from '@/lib/listing/resolve'

export type { ResolvedListingDetails }

export async function requestListingResolution(
  listing: ListingIdentity,
  signal?: AbortSignal
): Promise<ListingResolved | null> {
  return resolveListingIdentity(listing, signal)
}
