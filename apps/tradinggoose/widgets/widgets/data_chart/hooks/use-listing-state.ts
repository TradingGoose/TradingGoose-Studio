'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import {
  areListingIdentitiesEqual,
  type ListingIdentity,
  type ListingInputValue,
  type ListingOption,
  toListingValueObject,
} from '@/lib/listing/identity'
import {
  buildListingDisplay,
  getFlagData,
} from '@/widgets/widgets/data_chart/utils/listing-utils'

type UseListingStateArgs = {
  listingValue: ListingInputValue
  intervalLabel?: string | null
}

export type ListingState = {
  listing: ListingIdentity | null
  listingIdentitySignature: string | null
  resolvedListing: ListingOption | null
  isResolving: boolean
  tooltipTitle: string
}

const getListingDetailsFromValue = (listingValue: ListingInputValue) => {
  if (!listingValue || typeof listingValue !== 'object') return null
  const candidate = listingValue as ListingOption
  if (!hasResolvedListingDetails(candidate)) return null
  return candidate
}

const hasResolvedListingDetails = (listing?: ListingOption | null): boolean => {
  if (!listing) return false
  const base = listing.base?.trim()
  if (!base) return false
  if (listing.listing_type === 'default') return true
  const quote = listing.quote?.trim()
  return Boolean(quote)
}

export const useListingState = ({
  listingValue,
  intervalLabel,
}: UseListingStateArgs): ListingState => {
  const [resolvedListingState, setResolvedListing] = useState<ListingOption | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const listingResolveRef = useRef(0)
  const hydratedListingRef = useRef<ListingIdentity | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listingIdentityRef = useRef<ListingIdentity | null>(null)

  const listingIdentity = useMemo(() => {
    if (!listingValue || typeof listingValue !== 'object') return null
    return toListingValueObject(listingValue)
  }, [listingValue])

  const listing = listingIdentity ?? null
  const listingIdentitySignature = useMemo(() => {
    if (!listingIdentity) return null
    return `${listingIdentity.listing_type}|${listingIdentity.listing_id}|${listingIdentity.base_id}|${listingIdentity.quote_id}`
  }, [listingIdentity])

  const listingDetailsFromValue = useMemo(
    () => getListingDetailsFromValue(listingValue),
    [listingValue]
  )

  useEffect(() => {
    if (listingIdentity && !areListingIdentitiesEqual(listingIdentityRef.current, listingIdentity)) {
      listingIdentityRef.current = listingIdentity
    }

    const activeIdentity = listingIdentityRef.current
    if (!activeIdentity || !listingIdentitySignature) {
      setResolvedListing(null)
      setIsResolving(false)
      hydratedListingRef.current = null
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      return
    }

    if (listingDetailsFromValue) {
      setResolvedListing(listingDetailsFromValue)
      setIsResolving(false)
      hydratedListingRef.current = activeIdentity
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      return
    }

    setResolvedListing(null)

    let cancelled = false
    const retryDelayMs = 1000

    const scheduleRetry = () => {
      if (cancelled) return
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      retryTimeoutRef.current = setTimeout(() => {
        runResolve()
      }, retryDelayMs)
    }

    const runResolve = () => {
      if (cancelled) return
      setIsResolving(true)
      const requestId = ++listingResolveRef.current
      requestListingResolution(activeIdentity)
        .then((resolved) => {
          if (cancelled || listingResolveRef.current !== requestId) return
          if (resolved) {
            setResolvedListing(resolved)
            setIsResolving(false)
            if (retryTimeoutRef.current) {
              clearTimeout(retryTimeoutRef.current)
              retryTimeoutRef.current = null
            }
            return
          }
          scheduleRetry()
        })
        .catch(() => {
          if (cancelled || listingResolveRef.current !== requestId) return
          scheduleRetry()
        })
    }

    if (!areListingIdentitiesEqual(hydratedListingRef.current, activeIdentity)) {
      hydratedListingRef.current = activeIdentity
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      runResolve()
    }

    return () => {
      cancelled = true
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
    }
  }, [listingDetailsFromValue, listingIdentity, listingIdentitySignature])

  const resolvedListingIdentity = useMemo(
    () => toListingValueObject(resolvedListingState),
    [resolvedListingState]
  )
  const displayListing = useMemo(() => {
    if (listingDetailsFromValue) return listingDetailsFromValue
    if (!listingIdentity || !resolvedListingState) return null
    if (
      resolvedListingIdentity &&
      !areListingIdentitiesEqual(resolvedListingIdentity, listingIdentity)
    ) {
      return null
    }
    return resolvedListingState
  }, [listingDetailsFromValue, listingIdentity, resolvedListingIdentity, resolvedListingState])

  const listingType = displayListing?.listing_type ?? listingIdentity?.listing_type
  const { listingSymbolText, listingName } = useMemo(
    () => buildListingDisplay(displayListing),
    [displayListing]
  )
  const flagData = useMemo(
    () => (listingType === 'default' ? getFlagData(displayListing?.countryCode) : null),
    [displayListing?.countryCode, listingType]
  )
  const overlayLabel = useMemo(() => {
    let text = listingSymbolText
    if (listingName && listingName !== listingSymbolText) {
      text = `${text} - ${listingName}`
    }
    return text
  }, [listingName, listingSymbolText])
  const tooltipLabel = useMemo(() => {
    if (listingType === 'default' && flagData?.emoji) {
      return `${overlayLabel} ${flagData.emoji}`
    }
    return overlayLabel
  }, [flagData?.emoji, listingType, overlayLabel])
  const intervalText = intervalLabel ?? ''
  const tooltipTitle = useMemo(() => {
    if (!intervalText) return tooltipLabel
    return `${tooltipLabel} - ${intervalText}`
  }, [intervalText, tooltipLabel])

  return {
    listing,
    listingIdentitySignature,
    resolvedListing: displayListing,
    isResolving,
    tooltipTitle,
  }
}
