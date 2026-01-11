'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { ListingOption } from '@/stores/market/selector/store'

export function getListingPrimary(listing: ListingOption): string {
  return listing.base?.trim() || listing.name?.trim() || listing.id
}

export function getListingSecondary(listing: ListingOption): string | null {
  const base = listing.base?.trim()
  const name = listing.name?.trim()
  if (!name) return null
  if (base && base.toLowerCase() === name.toLowerCase()) return null
  return name
}

export function getListingFallback(listing: ListingOption): string {
  const base = listing.base?.trim() || listing.name?.trim() || listing.id
  return base.slice(0, 2).toUpperCase()
}

export function getFlagData(
  countryCode?: string | null
): { emoji: string; codepoints: string } | null {
  if (!countryCode) return null
  const code = countryCode.trim().toUpperCase()
  if (code.length !== 2) return null
  const flagOffset = 0x1f1e6
  const asciiOffset = 0x41
  const first = code.codePointAt(0)
  const second = code.codePointAt(1)
  if (first == null || second == null) return null
  if (first < asciiOffset || first > asciiOffset + 25) return null
  if (second < asciiOffset || second > asciiOffset + 25) return null
  const firstChar = first - asciiOffset + flagOffset
  const secondChar = second - asciiOffset + flagOffset
  const emoji = String.fromCodePoint(firstChar, secondChar)
  const codepoints = `${firstChar.toString(16)}-${secondChar.toString(16)}`
  return { emoji, codepoints }
}

export interface MarketListingRowProps {
  listing?: ListingOption | null
  placeholderTitle?: string
  placeholderSubtitle?: string
  showAssetClass?: boolean
  className?: string
}

export function MarketListingRow({
  listing,
  placeholderTitle = 'Select listing',
  placeholderSubtitle = 'Search by symbol or name',
  showAssetClass = false,
  className,
}: MarketListingRowProps) {
  const primary = listing ? getListingPrimary(listing) : ''
  const secondary = listing ? getListingSecondary(listing) : null
  const quote = listing?.quote?.trim() || ''
  const assetClassLabel = listing?.assetClass?.toUpperCase() ?? ''
  const flagData = getFlagData(listing?.countryCode)
  const prefersFlagImage =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const flagEmoji = flagData?.emoji ?? null
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null

  return (
    <div className={cn('flex items-center gap-2 pr-2', className)}>
      <Avatar className='h-6 w-6 rounded-sm m-1 text-foreground bg-secondary/60'>
        {listing?.iconUrl ? <AvatarImage src={listing.iconUrl} alt={primary} /> : null}
        <AvatarFallback className='text-xs text-accent-foreground'>
          {listing ? getListingFallback(listing) : '??'}
        </AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5 text-start leading-none'>
        {listing ? (
          <span className='flex items-center gap-1 text-sm font-semibold'>
            <span className='max-w-[22ch] truncate'>
              {primary}
              {quote ? <span className='text-muted-foreground'>/{quote}</span> : null}
            </span>
            {prefersFlagImage && flagImageUrl ? (
              <img
                src={flagImageUrl}
                alt={`${listing.countryCode ?? ''} flag`}
                className='ml-1 h-3.5 w-3.5'
                loading='lazy'
              />
            ) : flagEmoji ? (
              <span className='ml-1 text-xs'>{flagEmoji}</span>
            ) : null}
          </span>
        ) : (
          <span className='max-w-[20ch] truncate text-sm font-semibold text-muted-foreground'>
            {placeholderTitle}
          </span>
        )}
        <span className='max-w-[26ch] truncate text-xs text-muted-foreground'>
          {listing ? secondary ?? '—' : placeholderSubtitle}
        </span>
      </div>
      {showAssetClass && listing ? (
        <span className='ml-auto text-xs font-semibold text-muted-foreground'>
          {assetClassLabel}
        </span>
      ) : null}
    </div>
  )
}
