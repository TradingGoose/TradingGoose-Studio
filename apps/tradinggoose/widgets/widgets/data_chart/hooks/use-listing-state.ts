'use client'

import { useEffect, useRef, useState } from 'react'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'

type UseListingStateArgs = {
  listingValue: ListingIdentity | null | undefined
}

export type ListingState = {
  listing: ListingIdentity | null
  listingIdentitySignature: string | null
  resolvedListing: ListingResolved | null
  isResolving: boolean
}

const RESOLVE_RETRY_MS = 1000

type ResolvedEntry = {
  signature: string
  listing: ListingResolved
}

/**
 * Resolves a widget-param listing identity into full listing details.
 *
 * `params.listing` is always the minimal `ListingIdentity` (the widget contract
 * normalizes it), so the only source of display details is the market
 * resolution endpoint. Resolution is keyed on the stable identity *signature*
 * string — not on the identity object reference — so unrelated widget-param
 * re-renders (view/interval/live bars/drawings churn) never cancel or restart
 * an in-flight resolution.
 */
export const useListingState = ({ listingValue }: UseListingStateArgs): ListingState => {
  const listing = listingValue ?? null
  const listingIdentitySignature = listing ? getListingIdentityKey(listing) : null

  const [resolved, setResolved] = useState<ResolvedEntry | null>(null)

  // The effect below is keyed on `listingIdentitySignature` (a value-stable
  // string). This ref hands it the current identity object without adding an
  // unstable dependency that would re-run — and cancel — resolution on every
  // param re-render.
  const listingRef = useRef<ListingIdentity | null>(listing)
  listingRef.current = listing

  useEffect(() => {
    const identity = listingRef.current
    if (!listingIdentitySignature || !identity) return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const run = () => {
      requestListingResolution(identity)
        .then((result) => {
          if (cancelled) return
          if (result) {
            setResolved({ signature: listingIdentitySignature, listing: result })
            return
          }
          retryTimer = setTimeout(run, RESOLVE_RETRY_MS)
        })
        .catch(() => {
          if (cancelled) return
          retryTimer = setTimeout(run, RESOLVE_RETRY_MS)
        })
    }

    run()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [listingIdentitySignature])

  const resolvedListing =
    resolved && resolved.signature === listingIdentitySignature ? resolved.listing : null
  const isResolving = Boolean(listingIdentitySignature) && !resolvedListing

  return {
    listing,
    listingIdentitySignature,
    resolvedListing,
    isResolving,
  }
}
