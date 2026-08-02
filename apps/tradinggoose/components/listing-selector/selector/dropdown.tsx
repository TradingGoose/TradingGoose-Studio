'use client'

import { type ReactNode, type TouchEvent, useEffect, useRef, type WheelEvent } from 'react'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import {
  type SidebarDropdownGroup,
  type SidebarDropdownItem,
  SidebarDropdownMenuContent,
} from '@/components/ui/sidebar-dropdown-menu'
import type { ListingOption } from '@/lib/listing/identity'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'

type ListingSelectorDropdownContentProps = {
  groups: SidebarDropdownGroup[]
  activeGroupId: string
  onActiveGroupChange: (groupId: string) => void
  results: ListingOption[]
  busy: boolean
  error?: string
  highlightedIndex: number
  onHighlightChange: (index: number) => void
  onSelect: (listing: ListingOption) => void
  renderListing?: (listing: ListingOption) => ReactNode
  onWheelCapture?: (event: WheelEvent<HTMLDivElement>) => void
  onTouchMove?: (event: TouchEvent<HTMLDivElement>) => void
}

export function ListingSelectorDropdownContent({
  groups,
  activeGroupId,
  onActiveGroupChange,
  results,
  busy,
  error,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  renderListing,
  onWheelCapture,
  onTouchMove,
}: ListingSelectorDropdownContentProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const copy = useWorkspaceWidgetsMessages().listingSelector
  const items: SidebarDropdownItem[] = results.map((listing, index) => ({
    id: String(index),
    groupId: activeGroupId,
    label: listing.name?.trim() || listing.base?.trim() || 'Listing',
    content: renderListing ? (
      renderListing(listing)
    ) : (
      <MarketListingRow listing={listing} showAssetClass className='w-full' />
    ),
  }))

  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return
    const target = dropdownRef.current.querySelector(`[data-option-index="${highlightedIndex}"]`)
    if (target && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  return (
    <div
      ref={dropdownRef}
      className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-md'
      onMouseLeave={() => onHighlightChange(-1)}
      onWheelCapture={onWheelCapture}
      onTouchMove={onTouchMove}
    >
      <SidebarDropdownMenuContent
        groups={groups}
        items={items}
        activeGroupId={activeGroupId}
        highlightedItemId={highlightedIndex >= 0 ? String(highlightedIndex) : null}
        onActiveGroupChange={onActiveGroupChange}
        onHighlightItem={(_item, index) => onHighlightChange(index)}
        onSelectItem={(item) => {
          const listing = results[Number(item.id)]
          if (listing) onSelect(listing)
        }}
        loadingContent={busy ? copy.searching : null}
        emptyContent={error || copy.noListingsFound}
      />
    </div>
  )
}
