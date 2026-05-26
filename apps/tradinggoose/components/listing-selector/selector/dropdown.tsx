'use client'

import {
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useRef,
  type WheelEvent,
} from 'react'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import type { ListingOption } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'

type ListingSelectorDropdownContentProps = {
  results: ListingOption[]
  isLoading: boolean
  error?: string
  highlightedIndex: number
  onHighlightChange: (index: number) => void
  onSelect: (listing: ListingOption) => void
  renderListing?: (listing: ListingOption) => ReactNode
  scrollStyle?: CSSProperties
  onWheelCapture?: (event: WheelEvent<HTMLDivElement>) => void
  onTouchMove?: (event: TouchEvent<HTMLDivElement>) => void
}

export function ListingSelectorDropdownContent({
  results,
  isLoading,
  error,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  renderListing,
  scrollStyle,
  onWheelCapture,
  onTouchMove,
}: ListingSelectorDropdownContentProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return
    const target = dropdownRef.current.querySelector(`[data-option-index="${highlightedIndex}"]`)
    if (target && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  return (
    <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
      <div
        ref={dropdownRef}
        className='allow-scroll max-h-64 overflow-y-auto p-1'
        style={scrollStyle ?? { scrollbarWidth: 'thin' }}
        onMouseLeave={() => onHighlightChange(-1)}
        onWheelCapture={onWheelCapture}
        onTouchMove={onTouchMove}
      >
        {isLoading ? (
          <div className='py-6 text-center text-muted-foreground text-sm'>Searching...</div>
        ) : results.length === 0 ? (
          <div className='py-6 text-center text-muted-foreground text-sm'>
            {error || 'No listings found.'}
          </div>
        ) : (
          results.map((listing, index) => {
            const isHighlighted = index === highlightedIndex
            return (
              <div
                key={`${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`}
                data-option-index={index}
                onMouseEnter={() => onHighlightChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(listing)
                }}
                className={cn(
                  'flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                  isHighlighted && 'bg-accent text-accent-foreground'
                )}
              >
                {renderListing ? (
                  renderListing(listing)
                ) : (
                  <MarketListingRow listing={listing} showAssetClass className='w-full' />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

type ListingSelectorDropdownProps = ListingSelectorDropdownContentProps & {
  visible: boolean
}

export function ListingSelectorDropdown({
  visible,
  ...contentProps
}: ListingSelectorDropdownProps) {
  if (!visible) return null

  return (
    <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
      <ListingSelectorDropdownContent {...contentProps} />
    </div>
  )
}
