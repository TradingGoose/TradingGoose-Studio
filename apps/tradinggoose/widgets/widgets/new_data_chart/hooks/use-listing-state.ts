'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ListingIdentity,
  type ListingInputValue,
  type ListingOption,
  resolveListingKey,
  toListingValueObject,
} from '@/lib/listing/identity'
import { requestListingResolution } from '@/components/listing-selector/selector/resolve-request'
import { buildListingDisplay, getFlagData } from '@/widgets/widgets/new_data_chart/utils/listing-utils'

type UseListingStateArgs = {
  listingValue: ListingInputValue
  intervalLabel?: string | null
}

export type ListingState = {
  listing: ListingIdentity | null
  listingKey: string | null
  listingIdentity: ListingIdentity | null
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
  if (listing.listing_type === 'equity') return true
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
  const hydratedKeyRef = useRef<string | null>(null)

  const listingIdentity = useMemo(() => {
    if (!listingValue || typeof listingValue !== 'object') return null
    return toListingValueObject(listingValue)
  }, [listingValue])

  const listingKey = listingIdentity ? resolveListingKey(listingIdentity) ?? null : null
  const listing = listingKey ? listingIdentity : null

  const listingDetailsFromValue = useMemo(
    () => getListingDetailsFromValue(listingValue),
    [listingValue]
  )

  useEffect(() => {
    if (!listingIdentity || !listingKey) {
      setResolvedListing(null)
      setIsResolving(false)
      hydratedKeyRef.current = null
      return
    }

    if (listingDetailsFromValue) {
      setResolvedListing(listingDetailsFromValue)
      setIsResolving(false)
      hydratedKeyRef.current = listingKey
      return
    }

    setResolvedListing(null)
    setIsResolving(true)

    if (hydratedKeyRef.current === listingKey) {
      setIsResolving(false)
      return
    }

    hydratedKeyRef.current = listingKey
    const requestId = ++listingResolveRef.current
    let cancelled = false

    requestListingResolution(listingIdentity)
      .then((resolved) => {
        if (cancelled || listingResolveRef.current !== requestId) return
        if (!resolved) {
          setIsResolving(false)
          return
        }
        setResolvedListing(resolved)
        setIsResolving(false)
      })
      .catch(() => {
        if (cancelled || listingResolveRef.current !== requestId) return
        setIsResolving(false)
      })

    return () => {
      cancelled = true
    }
  }, [listingDetailsFromValue, listingIdentity, listingKey])

  const resolvedListingKey = useMemo(() => {
    if (!resolvedListingState) return null
    return resolveListingKey(resolvedListingState) ?? resolvedListingState.id ?? null
  }, [resolvedListingState])
  const displayListing = useMemo(() => {
    if (listingDetailsFromValue) return listingDetailsFromValue
    if (!listingKey || !resolvedListingState) return null
    if (resolvedListingKey && resolvedListingKey !== listingKey) return null
    return resolvedListingState
  }, [listingDetailsFromValue, listingKey, resolvedListingKey, resolvedListingState])

  const listingType = displayListing?.listing_type ?? listingIdentity?.listing_type
  const { listingSymbolText, listingName } = useMemo(
    () => buildListingDisplay(displayListing),
    [displayListing]
  )
  const flagData = useMemo(
    () => (listingType === 'equity' ? getFlagData(displayListing?.countryCode) : null),
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
    if (listingType === 'equity' && flagData?.emoji) {
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
    listingKey,
    listingIdentity,
    resolvedListing: displayListing,
    isResolving,
    tooltipTitle,
  }
}
