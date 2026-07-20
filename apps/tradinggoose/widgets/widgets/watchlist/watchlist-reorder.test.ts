import { describe, expect, it } from 'vitest'
import type { WatchlistItem } from '@/lib/watchlists/types'
import {
  createWatchlistContainerSortableId,
  createWatchlistListingSortableId,
  moveWatchlistItem,
  resolveDraggedItem,
  resolveDropTarget,
  resolveEffectiveDropTarget,
  WATCHLIST_ROOT_SORTABLE_ID,
} from '@/widgets/widgets/watchlist/components/watchlist-reorder'

const listing = (id: string, parentId: string | null = null): WatchlistItem => ({
  id,
  type: 'listing',
  parentId,
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
  parentId: null,
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

  it('moves listings to the hovered final index when dragging downward', () => {
    const items = [listing('a'), listing('b'), listing('c')]

    expect(
      moveWatchlistItem(
        items,
        createWatchlistListingSortableId('a'),
        createWatchlistListingSortableId('b')
      )?.map((item) => item.id)
    ).toEqual(['b', 'a', 'c'])
    expect(
      moveWatchlistItem(
        items,
        createWatchlistListingSortableId('a'),
        createWatchlistListingSortableId('c')
      )?.map((item) => item.id)
    ).toEqual(['b', 'c', 'a'])
  })

  it('moves a listing to the end of a target section', () => {
    const items = [
      listing('a'),
      section('s1'),
      listing('b', 's1'),
      listing('c', 's1'),
      section('s2'),
      listing('d', 's2'),
    ]

    const next = moveWatchlistItem(
      items,
      createWatchlistListingSortableId('a'),
      createWatchlistContainerSortableId('s1')
    )

    expect(next?.find((item) => item.id === 'a')?.parentId).toBe('s1')
  })

  it('moves a listing to root area before the first section', () => {
    const items = [
      section('s1'),
      listing('a', 's1'),
      listing('b', 's1'),
      section('s2'),
      listing('c', 's2'),
    ]

    const next = moveWatchlistItem(
      items,
      createWatchlistListingSortableId('c'),
      WATCHLIST_ROOT_SORTABLE_ID
    )

    expect(next?.map((item) => [item.id, item.parentId])).toEqual([
      ['c', null],
      ['s1', null],
      ['a', 's1'],
      ['b', 's1'],
      ['s2', null],
    ])
  })

  it('reorders sections at the root without rewriting their listing parents', () => {
    const items = [
      listing('a'),
      section('s1'),
      listing('b', 's1'),
      listing('c', 's1'),
      section('s2'),
      listing('d', 's2'),
    ]

    const next = moveWatchlistItem(
      items,
      createWatchlistContainerSortableId('s2'),
      createWatchlistContainerSortableId('s1')
    )

    expect(next?.map((item) => item.id)).toEqual(['a', 's2', 's1', 'b', 'c', 'd'])
    expect(next?.find((item) => item.id === 's2')?.parentId).toBeNull()
    expect(next?.find((item) => item.id === 'd')?.parentId).toBe('s2')
  })

  it('moves sections to the hovered final index when dragging downward', () => {
    const items = [section('s1'), section('s2'), section('s3')]

    const next = moveWatchlistItem(
      items,
      createWatchlistContainerSortableId('s1'),
      createWatchlistContainerSortableId('s3')
    )

    expect(next?.map((item) => item.id)).toEqual(['s2', 's3', 's1'])
  })

  it('resolves a section drag over child rows before the root section block', () => {
    const items = [
      listing('a'),
      section('s1'),
      listing('b', 's1'),
      listing('c', 's1'),
      section('s2'),
      listing('d', 's2'),
    ]

    expect(
      resolveEffectiveDropTarget(
        items,
        createWatchlistContainerSortableId('s2'),
        createWatchlistListingSortableId('b')
      )
    ).toEqual({ type: 'position', itemId: 's1' })
  })

  it('resolves a section drag over an unsectioned row as a root reorder', () => {
    const items = [listing('a'), listing('b'), section('s1'), listing('c', 's1')]

    expect(
      resolveEffectiveDropTarget(
        items,
        createWatchlistContainerSortableId('s1'),
        createWatchlistListingSortableId('a')
      )
    ).toEqual({ type: 'position', itemId: 'a' })
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
        createWatchlistContainerSortableId('s1'),
        createWatchlistContainerSortableId('s1')
      )
    ).toBeNull()
  })

  it('maps sortable ids to dragged items and raw drop targets', () => {
    const listingSortableId = createWatchlistListingSortableId('l1')
    const sectionSortableId = createWatchlistContainerSortableId('s1')

    expect(resolveDraggedItem(listingSortableId)).toEqual({ type: 'listing', itemId: 'l1' })
    expect(resolveDraggedItem(sectionSortableId)).toEqual({ type: 'container', itemId: 's1' })

    expect(resolveDropTarget(listingSortableId)).toEqual({ type: 'position', itemId: 'l1' })
    expect(resolveDropTarget(sectionSortableId)).toEqual({
      type: 'container',
      containerId: 's1',
    })
    expect(resolveDropTarget(WATCHLIST_ROOT_SORTABLE_ID)).toEqual({ type: 'root' })
    expect(resolveDropTarget('unknown')).toBeNull()
  })
})
