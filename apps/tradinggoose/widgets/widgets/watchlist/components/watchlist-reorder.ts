import type { WatchlistItem } from '@/lib/watchlists/types'

export type WatchlistDropTarget =
  | { type: 'before'; itemId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'root' }

export type DraggedWatchlistItem =
  | { type: 'listing'; itemId: string }
  | { type: 'section'; itemId: string }

const LISTING_SORTABLE_PREFIX = 'watchlist-listing:'
const SECTION_SORTABLE_PREFIX = 'watchlist-section:'

export const WATCHLIST_ROOT_SORTABLE_ID = 'watchlist-root'

export const createWatchlistListingSortableId = (itemId: string) =>
  `${LISTING_SORTABLE_PREFIX}${itemId}`

export const createWatchlistSectionSortableId = (sectionId: string) =>
  `${SECTION_SORTABLE_PREFIX}${sectionId}`

export const resolveDraggedItem = (sortableId: string): DraggedWatchlistItem | null => {
  if (sortableId.startsWith(LISTING_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(LISTING_SORTABLE_PREFIX.length)
    return itemId ? { type: 'listing', itemId } : null
  }

  if (sortableId.startsWith(SECTION_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(SECTION_SORTABLE_PREFIX.length)
    return itemId ? { type: 'section', itemId } : null
  }

  return null
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

const findSectionStartIndex = (items: WatchlistItem[], sectionId: string) =>
  items.findIndex((item) => item.id === sectionId && item.type === 'section')

const findSectionEndIndex = (items: WatchlistItem[], sectionId: string) => {
  const startIndex = findSectionStartIndex(items, sectionId)
  if (startIndex === -1) return null

  for (let index = startIndex + 1; index < items.length; index += 1) {
    if (items[index]?.type === 'section') {
      return index
    }
  }

  return items.length
}

const resolveSectionAppendIndex = (items: WatchlistItem[], sectionId: string) => {
  const sectionIndex = findSectionStartIndex(items, sectionId)
  if (sectionIndex === -1) return null

  const sectionEndIndex = findSectionEndIndex(items, sectionId)
  return sectionEndIndex == null ? null : sectionEndIndex
}

const resolveRootInsertIndex = (items: WatchlistItem[]) => {
  const firstSectionIndex = items.findIndex((item) => item.type === 'section')
  return firstSectionIndex === -1 ? items.length : firstSectionIndex
}

const resolveOwningSectionId = (items: WatchlistItem[], listingId: string) => {
  const itemIndex = items.findIndex((item) => item.id === listingId && item.type === 'listing')
  if (itemIndex === -1) return null

  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    const candidate = items[index]
    if (candidate?.type === 'section') {
      return candidate.id
    }
  }

  return null
}

const moveListingItem = (
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
  } else if (target.type === 'section') {
    insertIndex = resolveSectionAppendIndex(remaining, target.sectionId)
  } else {
    insertIndex = resolveRootInsertIndex(remaining)
  }

  if (insertIndex == null || insertIndex === -1) return null

  const nextItems = [
    ...remaining.slice(0, insertIndex),
    draggedItem,
    ...remaining.slice(insertIndex),
  ]

  const unchanged = nextItems.every((item, index) => item.id === items[index]?.id)
  return unchanged ? null : nextItems
}

const moveSectionBlock = (
  items: WatchlistItem[],
  draggedSectionId: string,
  target: WatchlistDropTarget
) => {
  const sourceIndex = findSectionStartIndex(items, draggedSectionId)
  const sourceEndIndex = findSectionEndIndex(items, draggedSectionId)
  if (sourceIndex === -1 || sourceEndIndex == null) return null

  const block = items.slice(sourceIndex, sourceEndIndex)
  const remaining = [...items.slice(0, sourceIndex), ...items.slice(sourceEndIndex)]

  let insertIndex: number | null = null

  if (target.type === 'root') {
    insertIndex = resolveRootInsertIndex(remaining)
  } else if (target.type === 'section') {
    if (target.sectionId === draggedSectionId) return null
    insertIndex = findSectionStartIndex(remaining, target.sectionId)
  } else {
    const ownerSectionId = resolveOwningSectionId(remaining, target.itemId)
    insertIndex = ownerSectionId
      ? findSectionStartIndex(remaining, ownerSectionId)
      : resolveRootInsertIndex(remaining)
  }

  if (insertIndex == null || insertIndex === -1) return null

  const nextItems = [
    ...remaining.slice(0, insertIndex),
    ...block,
    ...remaining.slice(insertIndex),
  ]

  const unchanged = nextItems.every((item, index) => item.id === items[index]?.id)
  return unchanged ? null : nextItems
}

export const resolveEffectiveDropTarget = (
  items: WatchlistItem[],
  activeSortableId: string,
  overSortableId: string
): WatchlistDropTarget | null => {
  const active = resolveDraggedItem(activeSortableId)
  const rawTarget = resolveDropTarget(overSortableId)

  if (!active || !rawTarget) return null
  if (active.type === 'listing') return rawTarget
  if (rawTarget.type !== 'before') return rawTarget

  const ownerSectionId = resolveOwningSectionId(items, rawTarget.itemId)
  return ownerSectionId ? { type: 'section', sectionId: ownerSectionId } : { type: 'root' }
}

export const moveWatchlistItem = (
  items: WatchlistItem[],
  activeSortableId: string,
  overSortableId: string
) => {
  const active = resolveDraggedItem(activeSortableId)
  const target = resolveEffectiveDropTarget(items, activeSortableId, overSortableId)

  if (!active || !target) return null

  return active.type === 'section'
    ? moveSectionBlock(items, active.itemId, target)
    : moveListingItem(items, active.itemId, target)
}
