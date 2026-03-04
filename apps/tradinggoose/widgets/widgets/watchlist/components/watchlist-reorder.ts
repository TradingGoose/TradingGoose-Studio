import type { WatchlistItem } from '@/lib/watchlists/types'

export type WatchlistDropTarget =
  | { type: 'before'; itemId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'root' }

const LISTING_SORTABLE_PREFIX = 'watchlist-listing:'
const SECTION_SORTABLE_PREFIX = 'watchlist-section:'

export const WATCHLIST_UNSECTIONED_SORTABLE_ID = 'watchlist-unsectioned'
export const WATCHLIST_ROOT_SORTABLE_ID = WATCHLIST_UNSECTIONED_SORTABLE_ID

export const createWatchlistListingSortableId = (itemId: string) =>
  `${LISTING_SORTABLE_PREFIX}${itemId}`

export const createWatchlistSectionSortableId = (sectionId: string) =>
  `${SECTION_SORTABLE_PREFIX}${sectionId}`

export const resolveDraggedListingId = (sortableId: string) => {
  if (!sortableId.startsWith(LISTING_SORTABLE_PREFIX)) return null
  return sortableId.slice(LISTING_SORTABLE_PREFIX.length) || null
}

export const resolveDropTarget = (sortableId: string): WatchlistDropTarget | null => {
  if (sortableId === WATCHLIST_ROOT_SORTABLE_ID) {
    return { type: 'root' }
  }

  if (sortableId.startsWith(LISTING_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(LISTING_SORTABLE_PREFIX.length)
    return itemId ? { type: 'before', itemId } : null
  }

  if (sortableId.startsWith(SECTION_SORTABLE_PREFIX)) {
    const sectionId = sortableId.slice(SECTION_SORTABLE_PREFIX.length)
    return sectionId ? { type: 'section', sectionId } : null
  }

  return null
}

const resolveSectionAppendIndex = (items: WatchlistItem[], sectionId: string) => {
  const sectionIndex = items.findIndex((item) => item.id === sectionId && item.type === 'section')
  if (sectionIndex === -1) return null

  for (let index = sectionIndex + 1; index < items.length; index += 1) {
    if (items[index]?.type === 'section') {
      return index
    }
  }
  return items.length
}

const resolveRootInsertIndex = (items: WatchlistItem[]) => {
  const firstSectionIndex = items.findIndex((item) => item.type === 'section')
  return firstSectionIndex === -1 ? items.length : firstSectionIndex
}

export const moveWatchlistListingItem = (
  items: WatchlistItem[],
  draggedItemId: string,
  target: WatchlistDropTarget
) => {
  const sourceIndex = items.findIndex(
    (item) => item.id === draggedItemId && item.type === 'listing'
  )
  if (sourceIndex === -1) return null

  const draggedItem = items[sourceIndex]
  const remaining = items.filter((item) => item.id !== draggedItemId)

  let insertIndex: number | null = null

  if (target.type === 'before') {
    insertIndex = remaining.findIndex((item) => item.id === target.itemId)
    if (insertIndex === -1) return null
  } else if (target.type === 'section') {
    insertIndex = resolveSectionAppendIndex(remaining, target.sectionId)
  } else {
    insertIndex = resolveRootInsertIndex(remaining)
  }

  if (insertIndex == null) return null

  const nextItems = [
    ...remaining.slice(0, insertIndex),
    draggedItem,
    ...remaining.slice(insertIndex),
  ]

  const unchanged = nextItems.every((item, index) => item.id === items[index]?.id)
  return unchanged ? null : nextItems
}
