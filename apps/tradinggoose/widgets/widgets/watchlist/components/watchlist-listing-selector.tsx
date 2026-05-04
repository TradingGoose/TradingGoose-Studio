'use client'

import type { ListingOption } from '@/lib/listing/identity'
import { ListingSelector } from '@/widgets/widgets/components/listing-selector'

export interface WatchlistListingSelectorProps {
  instanceId: string
  blockId?: string
  disabled?: boolean
  className?: string
  providerType?: 'market' | 'trading'
  activateOnMount?: boolean
  onListingChange?: (listing: ListingOption | null) => void
  onListingValueChange?: (value: string | null) => void
  onListingTagSelect?: (value: string) => void
}

export function WatchlistListingSelector(props: WatchlistListingSelectorProps) {
  return <ListingSelector {...props} />
}
