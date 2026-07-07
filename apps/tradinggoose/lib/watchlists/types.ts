import type { ListingIdentity } from '@/lib/listing/identity'

export type WatchlistSettings = {
  showLogo: boolean
  showTicker: boolean
  showDescription: boolean
}

export type WatchlistListingItem = {
  id: string
  type: 'listing'
  parentId: string | null
  listing: ListingIdentity
}

export type WatchlistSectionItem = {
  id: string
  type: 'section'
  parentId: string | null
  label: string
}

export type WatchlistContainerItem = WatchlistSectionItem

export type WatchlistItem = WatchlistListingItem | WatchlistContainerItem

export type WatchlistDocumentListingInputItem = {
  id?: string
  type: 'listing'
  parentId?: string | null
  listing: ListingIdentity
}

export type WatchlistDocumentSectionInputItem = {
  id?: string
  type: 'section'
  parentId?: string | null
  label: string
}

export type WatchlistDocumentInputItem =
  | WatchlistDocumentListingInputItem
  | WatchlistDocumentSectionInputItem

export type WatchlistDocumentInputFields = {
  name: string
  settings: WatchlistSettings
  items: WatchlistDocumentInputItem[]
}

export type WatchlistDocumentFields = {
  name: string
  settings: WatchlistSettings
  items: WatchlistItem[]
}

export type WatchlistRecord = {
  id: string
  workspaceId: string
  name: string
  items: WatchlistItem[]
  settings: WatchlistSettings
  createdAt: string
  updatedAt: string
}
