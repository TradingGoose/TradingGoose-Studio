import type { ListingIdentity } from '@/lib/listing/identity'

export type WatchlistColumnKey = 'listing' | 'assetClass' | 'lastPrice' | 'change' | 'changePercent'

export type WatchlistSortDirection = 'asc' | 'desc'

export type WatchlistSort = {
  column: WatchlistColumnKey
  direction: WatchlistSortDirection
}

export type WatchlistSettings = {
  showLogo: boolean
  showTicker: boolean
  showDescription: boolean
}

export type WatchlistListingItem = {
  id: string
  type: 'listing'
  listing: ListingIdentity
}

export type WatchlistSectionItem = {
  id: string
  type: 'section'
  label: string
}

export type WatchlistItem = WatchlistListingItem | WatchlistSectionItem

export type WatchlistRecord = {
  id: string
  workspaceId: string
  userId: string
  name: string
  isSystem: boolean
  items: WatchlistItem[]
  settings: WatchlistSettings
  createdAt: string
  updatedAt: string
}

export type WatchlistImportOutcome = {
  addedCount: number
  skippedCount: number
  unresolvedSymbols: string[]
}
