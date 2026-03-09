import { describe, expect, it } from 'vitest'
import type { WatchlistItem } from '@/lib/watchlists/types'
import {
  createWatchlistListingSortableId,
  WATCHLIST_ROOT_SORTABLE_ID,
  createWatchlistSectionSortableId,
  moveWatchlistListingItem,
  resolveDraggedListingId,
  resolveDropTarget,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'

const listing = (id: string): WatchlistItem => ({
  id,
  type: 'listing',
  listing: {
    listing_id: id,
    base_id: '',
    quote_id: '',
    listing_type: 'default',
  },
})

const section = (id: string, label = id): WatchlistItem => ({
  id,
  type: 'section',
  label,
})

describe('watchlist reorder helpers', () => {
  it('moves a listing before another listing', () => {
    const items = [listing('a'), listing('b'), section('s1'), listing('c')]

    const next = moveWatchlistListingItem(items, 'c', { type: 'before', itemId: 'b' })

    expect(next?.map((item) => item.id)).toEqual(['a', 'c', 'b', 's1'])
  })

  it('moves a listing to the end of a target section', () => {
    const items = [listing('a'), section('s1'), listing('b'), listing('c'), section('s2'), listing('d')]

    const next = moveWatchlistListingItem(items, 'a', { type: 'section', sectionId: 's1' })

    expect(next?.map((item) => item.id)).toEqual(['s1', 'b', 'c', 'a', 's2', 'd'])
  })

  it('moves a listing to root area before first section', () => {
    const items = [section('s1'), listing('a'), listing('b'), section('s2'), listing('c')]

    const next = moveWatchlistListingItem(items, 'c', { type: 'root' })

    expect(next?.map((item) => item.id)).toEqual(['c', 's1', 'a', 'b', 's2'])
  })

  it('returns null when drop results in no change or invalid ids', () => {
    const items = [listing('a'), listing('b'), section('s1')]

    expect(moveWatchlistListingItem(items, 'a', { type: 'before', itemId: 'a' })).toBeNull()
    expect(moveWatchlistListingItem(items, 'missing', { type: 'before', itemId: 'a' })).toBeNull()
    expect(moveWatchlistListingItem(items, 'a', { type: 'section', sectionId: 'missing' })).toBeNull()
    expect(moveWatchlistListingItem(items, 's1', { type: 'before', itemId: 'a' })).toBeNull()
  })

  it('maps sortable ids to dragged listing id and drop target', () => {
    const listingSortableId = createWatchlistListingSortableId('l1')
    const sectionSortableId = createWatchlistSectionSortableId('s1')

    expect(resolveDraggedListingId(listingSortableId)).toBe('l1')
    expect(resolveDraggedListingId(sectionSortableId)).toBeNull()

    expect(resolveDropTarget(listingSortableId)).toEqual({ type: 'before', itemId: 'l1' })
    expect(resolveDropTarget(sectionSortableId)).toEqual({ type: 'section', sectionId: 's1' })
    expect(resolveDropTarget(WATCHLIST_ROOT_SORTABLE_ID)).toEqual({ type: 'root' })
    expect(resolveDropTarget('unknown')).toBeNull()
  })
})
