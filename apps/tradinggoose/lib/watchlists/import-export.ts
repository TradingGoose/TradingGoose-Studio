import { normalizeWatchlistItems } from '@/lib/watchlists/validation'
import type { WatchlistItem } from '@/lib/watchlists/types'

export const extractWatchlistItems = (itemsInput: unknown): WatchlistItem[] =>
  normalizeWatchlistItems(itemsInput)

export const exportWatchlistItemsAsJson = (itemsInput: unknown): string =>
  JSON.stringify(extractWatchlistItems(itemsInput), null, 2)
