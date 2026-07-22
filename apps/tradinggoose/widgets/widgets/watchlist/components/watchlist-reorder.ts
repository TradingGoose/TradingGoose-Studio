import type { WatchlistItem } from '@/lib/watchlists/types'

export type WatchlistDropTarget =
  | { type: 'position'; itemId: string }
  | { type: 'container'; containerId: string }
  | { type: 'root' }

export type DraggedWatchlistItem =
  | { type: 'listing'; itemId: string }
  | { type: 'container'; itemId: string }

const LISTING_SORTABLE_PREFIX = 'watchlist-listing:'
const CONTAINER_SORTABLE_PREFIX = 'watchlist-container:'

export const WATCHLIST_ROOT_SORTABLE_ID = 'watchlist-root'

export const createWatchlistListingSortableId = (itemId: string) =>
  `${LISTING_SORTABLE_PREFIX}${itemId}`

export const createWatchlistContainerSortableId = (containerId: string) =>
  `${CONTAINER_SORTABLE_PREFIX}${containerId}`

export const resolveDraggedItem = (sortableId: string): DraggedWatchlistItem | null => {
  if (sortableId.startsWith(LISTING_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(LISTING_SORTABLE_PREFIX.length)
    return itemId ? { type: 'listing', itemId } : null
  }

  if (sortableId.startsWith(CONTAINER_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(CONTAINER_SORTABLE_PREFIX.length)
    return itemId ? { type: 'container', itemId } : null
  }

  return null
}

export const resolveDropTarget = (sortableId: string): WatchlistDropTarget | null => {
  if (sortableId === WATCHLIST_ROOT_SORTABLE_ID) {
    return { type: 'root' }
  }

  if (sortableId.startsWith(LISTING_SORTABLE_PREFIX)) {
    const itemId = sortableId.slice(LISTING_SORTABLE_PREFIX.length)
    return itemId ? { type: 'position', itemId } : null
  }

  if (sortableId.startsWith(CONTAINER_SORTABLE_PREFIX)) {
    const containerId = sortableId.slice(CONTAINER_SORTABLE_PREFIX.length)
    return containerId ? { type: 'container', containerId } : null
  }

  return null
}

const findItem = (items: WatchlistItem[], itemId: string) =>
  items.find((item) => item.id === itemId) ?? null

const resolveTargetParentId = (
  items: WatchlistItem[],
  active: DraggedWatchlistItem,
  target: WatchlistDropTarget
) => {
  if (active.type === 'container') {
    return target.type === 'position' && target.itemId === active.itemId ? undefined : null
  }
  if (target.type === 'root') return null
  if (target.type === 'container') {
    const targetItem = findItem(items, target.containerId)
    return targetItem?.type === 'section' ? targetItem.id : undefined
  }

  const targetItem = findItem(items, target.itemId)
  return targetItem?.parentId ?? null
}

const resolveInsertIndex = (
  items: WatchlistItem[],
  remaining: WatchlistItem[],
  target: WatchlistDropTarget,
  parentId: string | null
) => {
  if (target.type === 'position') {
    return items.findIndex((item) => item.id === target.itemId)
  }

  if (target.type === 'root') {
    const firstSectionIndex = remaining.findIndex((item) => item.type === 'section')
    return firstSectionIndex === -1 ? remaining.length : firstSectionIndex
  }

  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    if ((remaining[index]?.parentId ?? null) === parentId) {
      return index + 1
    }
  }

  if (target.type === 'container') {
    const containerIndex = remaining.findIndex((item) => item.id === target.containerId)
    return containerIndex === -1 ? remaining.length : containerIndex + 1
  }

  return remaining.length
}

const moveItem = (
  items: WatchlistItem[],
  active: DraggedWatchlistItem,
  target: WatchlistDropTarget
) => {
  const sourceIndex = items.findIndex(
    (item) =>
      item.id === active.itemId &&
      (active.type === 'container' ? item.type === 'section' : item.type === active.type)
  )
  if (sourceIndex === -1) return null

  const nextParentId = resolveTargetParentId(items, active, target)
  if (nextParentId === undefined) return null

  const draggedItem = {
    ...items[sourceIndex],
    parentId: active.type === 'container' ? null : nextParentId,
  } as WatchlistItem
  const remaining = items.filter((item) => item.id !== active.itemId)
  const insertIndex = resolveInsertIndex(items, remaining, target, nextParentId)
  if (insertIndex === -1) return null

  const nextItems = [
    ...remaining.slice(0, insertIndex),
    draggedItem,
    ...remaining.slice(insertIndex),
  ]

  const unchanged =
    nextItems.length === items.length &&
    nextItems.every(
      (item, index) =>
        item.id === items[index]?.id && (item.parentId ?? null) === (items[index]?.parentId ?? null)
    )
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
  if (rawTarget.type === 'root') return rawTarget
  if (rawTarget.type === 'container') {
    return rawTarget.containerId === active.itemId
      ? null
      : { type: 'position', itemId: rawTarget.containerId }
  }

  const targetItem = findItem(items, rawTarget.itemId)
  const parentId = targetItem?.parentId ?? null
  if (!parentId) return rawTarget.itemId === active.itemId ? null : rawTarget
  return parentId === active.itemId ? null : { type: 'position', itemId: parentId }
}

export const moveWatchlistItem = (
  items: WatchlistItem[],
  activeSortableId: string,
  overSortableId: string
) => {
  const active = resolveDraggedItem(activeSortableId)
  const target = resolveEffectiveDropTarget(items, activeSortableId, overSortableId)

  if (!active || !target) return null

  return moveItem(items, active, target)
}
