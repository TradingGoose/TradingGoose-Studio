'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { ListingOption } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'

const resolveListingFallbackLabel = (listing: ListingOption): string => {
  const base = listing.base?.trim()
  if (base) return base
  const quote = listing.quote?.trim()
  if (quote) return quote
  const name = listing.name?.trim()
  if (name) return name
  return 'Listing'
}

export function getListingPrimary(listing: ListingOption): string {
  return resolveListingFallbackLabel(listing)
}

export function getListingSecondary(listing: ListingOption): string | null {
  const base = listing.base?.trim()
  const name = listing.name?.trim()
  if (!name) return null
  if (base && base.toLowerCase() === name.toLowerCase()) return null
  return name
}

export function getListingFallback(listing: ListingOption): string {
  const base = resolveListingFallbackLabel(listing)
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
  compact?: boolean
  className?: string
}

export function MarketListingRow({
  listing,
  placeholderTitle = 'Select listing',
  placeholderSubtitle = 'Search by symbol or name',
  showAssetClass = false,
  compact = false,
  className,
}: MarketListingRowProps) {
  const primary = listing ? getListingPrimary(listing) : ''
  const secondary = listing ? getListingSecondary(listing) : null
  const quote = listing?.quote?.trim() || ''
  const assetClassLabel = listing?.assetClass?.toUpperCase() ?? ''
  const flagData = getFlagData(listing?.countryCode)
  const flagImageUrl = flagData
    ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${flagData.codepoints}.svg`
    : null

  return (
    <div className={cn('flex items-center gap-2 pr-2', compact && 'h-8', className)}>
      <Avatar
        className={cn(
          'rounded-sm bg-secondary/60 text-foreground',
          compact ? 'h-5 w-5' : 'm-1 h-6 w-6'
        )}
      >
        {listing?.iconUrl ? <AvatarImage src={listing.iconUrl} alt={primary} /> : null}
        <AvatarFallback
          className={cn('text-accent-foreground', compact ? 'text-[10px]' : 'text-xs')}
        >
          {listing ? getListingFallback(listing) : '??'}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          'flex min-w-0 flex-1 text-start leading-none',
          compact ? 'items-center gap-1' : 'flex-col gap-0.5'
        )}
      >
        {listing ? (
          <span
            className={cn(
              'flex items-center gap-1 font-semibold text-sm',
              compact ? 'min-w-0' : ''
            )}
          >
            <span className={cn('truncate', compact ? 'max-w-full' : 'max-w-[22ch]')}>
              {primary}
              {quote ? <span className='text-muted-foreground'>/{quote}</span> : null}
            </span>
            {flagImageUrl ? (
              <img
                src={flagImageUrl}
                alt={`${listing.countryCode ?? ''} flag`}
                className='ml-1 h-3.5 w-3.5'
                loading='lazy'
              />
            ) : null}
          </span>
        ) : (
          <span className='max-w-full truncate font-semibold text-muted-foreground text-sm'>
            {placeholderTitle}
          </span>
        )}
        {!compact ? (
          <span className='max-w-full truncate text-muted-foreground text-xs'>
            {listing ? (secondary ?? '—') : placeholderSubtitle}
          </span>
        ) : null}
      </div>
      {showAssetClass && listing ? (
        <span
          className={cn(
            'ml-auto font-semibold text-muted-foreground',
            compact ? 'text-[10px]' : 'text-xs'
          )}
        >
          {assetClassLabel}
        </span>
      ) : null}
    </div>
  )
}
