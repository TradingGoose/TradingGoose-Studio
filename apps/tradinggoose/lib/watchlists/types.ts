import type { ListingIdentity } from '@/lib/listing/identity'

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

export type WatchlistImportFileListingItem = {
  type: 'listing'
  listing: ListingIdentity
}

export type WatchlistImportFileSection = {
  type: 'section'
  label: string
  items: WatchlistImportFileListingItem[]
}

export type WatchlistImportFileItem =
  | WatchlistImportFileListingItem
  | WatchlistImportFileSection

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
}
