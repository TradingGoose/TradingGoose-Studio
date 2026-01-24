'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type ListingIdentity,
  type ListingInputValue,
  type ListingOption,
  resolveListingKey,
  toListingValueObject,
} from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import {
  getFlagData,
  getListingFallback,
  getListingSymbol,
} from '@/widgets/widgets/data_chart/components/listing-utils'

type ListingSymbolParts = {
  base: string
  quote: string
}

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

const splitListingSymbol = (symbol: string): ListingSymbolParts => {
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

const buildListingDisplay = (listing: ListingOption | null) => {
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

    resolveListingIdentity(listingIdentity)
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

export const ListingOverlay = ({
  listing,
  intervalLabel,
  isResolving = false,
}: {
  listing: ListingOption | null
  intervalLabel?: string | null
  isResolving?: boolean
}) => {
  const { listingSymbol, listingSymbolParts, listingSymbolText, listingName } = useMemo(
    () => buildListingDisplay(listing),
    [listing]
  )
  const listingType = listing?.listing_type
  const listingIconUrl = listing?.iconUrl ?? null
  const avatarFallback = listingSymbol ? getListingFallback(listingSymbol) : '??'
  const flagData = useMemo(
    () => (listingType === 'equity' ? getFlagData(listing?.countryCode) : null),
    [listing?.countryCode, listingType]
  )
  const prefersFlagImage = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null
  const intervalText = intervalLabel ?? ''

  if (isResolving) {
    return (
      <div className='pointer-events-none absolute top-2 left-1 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 bg-background/60 px-2 py-1 font-semibold text-foreground text-lg'>
        <Skeleton className='h-8 w-8 rounded-sm' />
        <div className='flex min-w-0 items-center gap-2'>
          <Skeleton className='h-4 w-24' />
          {intervalText ? <Skeleton className='h-4 w-10' /> : null}
        </div>
      </div>
    )
  }

  if (!listing) return null

  return (
    <div className='pointer-events-none absolute top-2 left-1 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 bg-background/60 px-2 py-1 font-semibold text-foreground text-lg'>
      <Avatar className='h-8 w-8 rounded-sm border border-border bg-secondary/60'>
        {listingIconUrl ? <AvatarImage src={listingIconUrl} alt={listingSymbol} /> : null}
        <AvatarFallback className='text-[10px] text-accent-foreground'>
          {avatarFallback || '??'}
        </AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 items-center gap-1'>
        <span className='min-w-0 truncate'>
          <span>{listingSymbolParts.base}</span>
          {listingSymbolParts.quote ? (
            <span className='font-medium text-muted-foreground'>/{listingSymbolParts.quote}</span>
          ) : null}
          {listingName && listingName !== listingSymbolText ? (
            <span className='font-medium'> - {listingName}</span>
          ) : null}
        </span>
        {intervalText ? (
          <span className='mx-2 shrink-0 text-muted-foreground'>{intervalText}</span>
        ) : null}

        {listingType === 'equity' && flagData ? (
          prefersFlagImage && flagImageUrl ? (
            <img
              src={flagImageUrl}
              alt={`${listing?.countryCode ?? ''} flag`}
              className='h-3.5 w-3.5'
              loading='lazy'
            />
          ) : flagData.emoji ? (
            <span className='text-xs'>{flagData.emoji}</span>
          ) : null
        ) : null}
      </div>
    </div>
  )
}
