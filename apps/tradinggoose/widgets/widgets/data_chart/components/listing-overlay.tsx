'use client'

import { useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import type { ListingOption } from '@/lib/listing/identity'
import {
  buildListingDisplay,
  getFlagData,
  getListingFallback,
} from '@/widgets/widgets/data_chart/utils/listing-utils'

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
    () => (listingType === 'default' ? getFlagData(listing?.countryCode) : null),
    [listing?.countryCode, listingType]
  )
  const prefersFlagImage = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null
  const intervalText = intervalLabel ?? ''

  const wrapperClass =
    'flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-sm font-semibold text-foreground'

  if (isResolving) {
    return (
      <div className={wrapperClass}>
        <Skeleton className='h-6 w-6 rounded-sm my-[3px]' />
        <div className='flex min-w-0 max-w-full items-center gap-2'>
          <Skeleton className='h-4 w-24' />
          {intervalText ? <Skeleton className='h-4 w-10' /> : null}
        </div>
      </div>
    )
  }

  if (!listing) return null

  return (
    <div className={wrapperClass}>
      <Avatar className='h-6 w-6 rounded-sm border border-border bg-secondary/60'>
        {listingIconUrl ? <AvatarImage src={listingIconUrl} alt={listingSymbol} /> : null}
        <AvatarFallback className='text-[10px] text-accent-foreground'>
          {avatarFallback || '??'}
        </AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 max-w-full items-center gap-1 overflow-hidden'>
        <span className='min-w-0 shrink truncate text-lg'>
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

        {listingType === 'default' && flagData ? (
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
