'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import type { ListingOption } from '@/lib/listing/identity'

type DropdownPosition = {
  top: number
  left: number
  width: number
}

type StockSelectorDropdownProps = {
  visible: boolean
  results: ListingOption[]
  isLoading: boolean
  error?: string
  highlightedIndex: number
  onHighlightChange: (index: number) => void
  onSelect: (listing: ListingOption) => void
  portalPosition?: DropdownPosition | null
  selectorId?: string
}

export function StockSelectorDropdown({
  visible,
  results,
  isLoading,
  error,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  portalPosition,
  selectorId,
}: StockSelectorDropdownProps) {
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

  const content = (
    <div
      className={cn(
        portalPosition ? 'absolute z-[1000]' : 'absolute left-0 top-full z-[200] mt-1 w-full'
      )}
      style={
        portalPosition
          ? {
              top: portalPosition.top,
              left: portalPosition.left,
              width: portalPosition.width,
            }
          : undefined
      }
      data-market-selector
      data-market-selector-id={selectorId}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
        <div
          ref={dropdownRef}
          className='allow-scroll max-h-64 overflow-y-auto bg-popover p-1'
          style={{ scrollbarWidth: 'thin', overscrollBehavior: 'contain' }}
          onMouseLeave={() => onHighlightChange(-1)}
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
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
                    'flex cursor-pointer select-none items-center rounded-sm bg-popover px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
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

  if (!portalPosition || typeof document === 'undefined') {
    return content
  }

  return createPortal(content, document.body)
}
