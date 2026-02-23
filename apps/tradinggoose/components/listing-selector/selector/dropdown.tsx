'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import type { ListingOption } from '@/lib/listing/identity'

type ListingSelectorDropdownProps = {
  visible: boolean
  results: ListingOption[]
  isLoading: boolean
  error?: string
  highlightedIndex: number
  onHighlightChange: (index: number) => void
  onSelect: (listing: ListingOption) => void
}

export function ListingSelectorDropdown({
  visible,
  results,
  isLoading,
  error,
  highlightedIndex,
  onHighlightChange,
  onSelect,
}: ListingSelectorDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return
    const target = dropdownRef.current.querySelector(
      `[data-option-index="${highlightedIndex}"]`
    )
    if (target && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  if (!visible) return null

  return (
    <div className='absolute left-0 top-full z-[100] mt-1 w-full'>
      <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
        <div
          ref={dropdownRef}
          className='allow-scroll max-h-64 overflow-y-auto p-1'
          style={{ scrollbarWidth: 'thin' }}
          onMouseLeave={() => onHighlightChange(-1)}
        >
          {isLoading ? (
            <div className='py-6 text-center text-sm text-muted-foreground'>
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className='py-6 text-center text-sm text-muted-foreground'>
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
                  <MarketListingRow listing={listing} showAssetClass className='w-full' />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
