import {
  normalizeWatchlistImportFileItems,
  normalizeWatchlistItems,
} from '@/lib/watchlists/validation'
import type {
  WatchlistImportFileItem,
  WatchlistImportFileListingItem,
  WatchlistItem,
} from '@/lib/watchlists/types'

export const extractWatchlistImportFileItems = (itemsInput: unknown): WatchlistImportFileItem[] =>
  normalizeWatchlistImportFileItems(itemsInput)

const toWatchlistImportFileListingItem = (
  item: Extract<WatchlistItem, { type: 'listing' }>
): WatchlistImportFileListingItem => ({
  type: 'listing',
  listing: item.listing,
})

const toWatchlistImportFileItems = (items: WatchlistItem[]): WatchlistImportFileItem[] => {
  const output: WatchlistImportFileItem[] = []
  let currentSection: Extract<WatchlistImportFileItem, { type: 'section' }> | null = null

  for (const item of items) {
    if (item.type === 'section') {
      currentSection = {
        type: 'section',
        label: item.label,
        items: [],
      }
      output.push(currentSection)
      continue
    }

    if (currentSection) {
      currentSection.items.push(toWatchlistImportFileListingItem(item))
      continue
    }

    output.push(toWatchlistImportFileListingItem(item))
  }

  return output
}

export const exportWatchlistItemsAsJson = (itemsInput: unknown): string =>
  JSON.stringify(toWatchlistImportFileItems(normalizeWatchlistItems(itemsInput)), null, 2)
