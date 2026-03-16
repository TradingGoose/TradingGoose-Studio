import { describe, expect, it } from 'vitest'
import type { WatchlistItem } from '@/lib/watchlists/types'
import {
  createWatchlistListingSortableId,
  createWatchlistSectionSortableId,
  moveWatchlistItem,
  resolveDraggedItem,
  resolveDropTarget,
  resolveEffectiveDropTarget,
  WATCHLIST_ROOT_SORTABLE_ID,
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

    const next = moveWatchlistItem(
      items,
      createWatchlistListingSortableId('c'),
      createWatchlistListingSortableId('b')
    )

    expect(next?.map((item) => item.id)).toEqual(['a', 'c', 'b', 's1'])
  })

  it('moves a listing to the end of a target section', () => {
    const items = [listing('a'), section('s1'), listing('b'), listing('c'), section('s2'), listing('d')]

    const next = moveWatchlistItem(
      items,
      createWatchlistListingSortableId('a'),
      createWatchlistSectionSortableId('s1')
    )

    expect(next?.map((item) => item.id)).toEqual(['s1', 'b', 'c', 'a', 's2', 'd'])
  })

  it('moves a listing to root area before the first section', () => {
    const items = [section('s1'), listing('a'), listing('b'), section('s2'), listing('c')]

    const next = moveWatchlistItem(
      items,
      createWatchlistListingSortableId('c'),
      WATCHLIST_ROOT_SORTABLE_ID
    )

    expect(next?.map((item) => item.id)).toEqual(['c', 's1', 'a', 'b', 's2'])
  })

  it('moves a section as a block before another section', () => {
    const items = [listing('a'), section('s1'), listing('b'), listing('c'), section('s2'), listing('d')]

    const next = moveWatchlistItem(
      items,
      createWatchlistSectionSortableId('s2'),
      createWatchlistSectionSortableId('s1')
    )

    expect(next?.map((item) => item.id)).toEqual(['a', 's2', 'd', 's1', 'b', 'c'])
  })

  it('resolves a section drag over child rows to the target section block', () => {
    const items = [listing('a'), section('s1'), listing('b'), listing('c'), section('s2'), listing('d')]

    expect(
      resolveEffectiveDropTarget(
        items,
        createWatchlistSectionSortableId('s2'),
        createWatchlistListingSortableId('b')
      )
    ).toEqual({ type: 'section', sectionId: 's1' })
  })

  it('resolves a section drag over unsectioned rows to the root bucket', () => {
    const items = [listing('a'), listing('b'), section('s1'), listing('c')]

    expect(
      resolveEffectiveDropTarget(
        items,
        createWatchlistSectionSortableId('s1'),
        createWatchlistListingSortableId('a')
      )
    ).toEqual({ type: 'root' })
  })

  it('returns null when drop results in no change or invalid ids', () => {
    const items = [listing('a'), listing('b'), section('s1')]

    expect(
      moveWatchlistItem(
        items,
        createWatchlistListingSortableId('a'),
        createWatchlistListingSortableId('a')
      )
    ).toBeNull()
    expect(
      moveWatchlistItem(
        items,
        createWatchlistListingSortableId('missing'),
        createWatchlistListingSortableId('a')
      )
    ).toBeNull()
    expect(
      moveWatchlistItem(
        items,
        createWatchlistSectionSortableId('s1'),
        createWatchlistSectionSortableId('s1')
      )
    ).toBeNull()
  })

  it('maps sortable ids to dragged items and raw drop targets', () => {
    const listingSortableId = createWatchlistListingSortableId('l1')
    const sectionSortableId = createWatchlistSectionSortableId('s1')

    expect(resolveDraggedItem(listingSortableId)).toEqual({ type: 'listing', itemId: 'l1' })
    expect(resolveDraggedItem(sectionSortableId)).toEqual({ type: 'section', itemId: 's1' })

    expect(resolveDropTarget(listingSortableId)).toEqual({ type: 'before', itemId: 'l1' })
    expect(resolveDropTarget(sectionSortableId)).toEqual({ type: 'section', sectionId: 's1' })
    expect(resolveDropTarget(WATCHLIST_ROOT_SORTABLE_ID)).toEqual({ type: 'root' })
    expect(resolveDropTarget('unknown')).toBeNull()
  })
})
