'use client'

import { useEffect } from 'react'
import { StockSelector } from '@/components/listing-selector/selector/input'
import type { ListingOption } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import { useListingSelectorStore } from '@/stores/market/selector/store'

export interface ListingSelectorProps {
  instanceId: string
  blockId?: string
  className?: string
  disabled?: boolean
  providerType?: 'market' | 'trading'
  marketProviderId?: string
  tradingProviderId?: string
  candidateListings?: ListingOption[]
  candidateListingsLoading?: boolean
  candidateListingsError?: string
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
  listingRequired?: boolean
}

export function ListingSelector({
  instanceId,
  blockId,
  className,
  disabled,
  providerType = 'market',
  marketProviderId,
  tradingProviderId,
  candidateListings,
  candidateListingsLoading,
  candidateListingsError,
  onListingChange,
  onListingValueChange,
  onListingTagSelect,
  listingRequired,
}: ListingSelectorProps) {
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div className='space-y-1.5'>
        <div className='flex items-center font-medium text-muted-foreground text-xs'>
          Listing
          {listingRequired ? <span className='ml-1 text-red-500'>*</span> : null}
        </div>
        <StockSelector
          instanceId={instanceId}
          blockId={blockId}
          disabled={disabled}
          providerType={providerType}
          marketProviderId={marketProviderId}
          tradingProviderId={tradingProviderId}
          candidateListings={candidateListings}
          candidateListingsLoading={candidateListingsLoading}
          candidateListingsError={candidateListingsError}
          onListingChange={onListingChange}
          onListingValueChange={onListingValueChange}
          onListingTagSelect={onListingTagSelect}
        />
      </div>
    </div>
  )
}
