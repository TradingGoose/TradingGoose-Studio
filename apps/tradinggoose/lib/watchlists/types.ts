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

export type WatchlistRecord = {
  id: string
  workspaceId: string
  name: string
  items: WatchlistItem[]
  settings: WatchlistSettings
  createdAt: string
  updatedAt: string
}
