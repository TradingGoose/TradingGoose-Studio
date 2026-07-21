import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { WatchlistItem } from '@/lib/watchlists/types'
import {
  getEntityFields,
  getEntityListMembers,
  readWatchlistItems,
  replaceEntityListSessionMembers,
  seedEntitySession,
  updateWatchlistItems,
} from './entity-session'

const documents: Y.Doc[] = []
const createDocument = () => {
  const doc = new Y.Doc()
  documents.push(doc)
  return doc
}

afterEach(() => {
  for (const doc of documents.splice(0)) doc.destroy()
})

describe('entity list sessions', () => {
  it('orders duplicate names deterministically by id', () => {
    const doc = createDocument()
    replaceEntityListSessionMembers(doc, [
      { id: 'entity-b', name: 'Same' },
      { id: 'entity-a', name: 'Same' },
      { id: 'entity-c', name: 'Other' },
    ])

    expect(getEntityListMembers(doc, 'skill').map((member) => member.entityId)).toEqual([
      'entity-c',
      'entity-a',
      'entity-b',
    ])
  })

  it('orders dashboard layouts by tab order', () => {
    const doc = createDocument()
    replaceEntityListSessionMembers(doc, [
      {
        id: 'layout-b',
        name: 'Tie B',
        sortOrder: 1,
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'layout-c',
        name: 'Tie C',
        sortOrder: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'layout-a',
        name: 'Active',
        sortOrder: 0,
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    ])

    expect(getEntityListMembers(doc, 'dashboard_layout').map((member) => member.entityId)).toEqual([
      'layout-a',
      'layout-c',
      'layout-b',
    ])
  })
})

describe('watchlist entity sessions', () => {
  const listing = (id: string, symbol = id) => ({
    id,
    type: 'listing' as const,
    parentId: null,
    listing: {
      listing_type: 'default' as const,
      listing_id: symbol,
      base_id: '',
      quote_id: '',
    },
  })

  const rawItems = (doc: Y.Doc) => doc.getMap('fields').get('items') as Y.Map<Y.Map<unknown>>
  const rawEntry = (doc: Y.Doc) => rawItems(doc).values().next().value!
  const settings = { showLogo: true, showTicker: true, showDescription: true }
  const seedWatchlist = (doc: Y.Doc, items: WatchlistItem[]) =>
    seedEntitySession(doc, { entityKind: 'watchlist', payload: { settings, items } })

  const mergeConcurrentChanges = (
    initialItems: WatchlistItem[],
    updateLeft: (items: WatchlistItem[]) => WatchlistItem[],
    updateRight: (items: WatchlistItem[]) => WatchlistItem[]
  ) => {
    const left = createDocument()
    const right = createDocument()
    seedWatchlist(left, initialItems)
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left))

    updateWatchlistItems(left, updateLeft)
    updateWatchlistItems(right, updateRight)
    seedWatchlist(left, getEntityFields(left, 'watchlist').items)
    const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right))
    const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left))
    Y.applyUpdate(left, rightUpdate)
    Y.applyUpdate(right, leftUpdate)
    return [readWatchlistItems(left), readWatchlistItems(right)]
  }

  const invalidRawEntries: Array<[string, (doc: Y.Doc) => void]> = [
    ['unknown type', (doc) => rawEntry(doc).set('type', 'unknown')],
    [
      'unlabeled section',
      (doc) => {
        const entry = rawEntry(doc)
        entry.set('type', 'section')
        entry.set('label', '')
        entry.delete('listing')
      },
    ],
    [
      'nested section',
      (doc) => {
        const entry = rawEntry(doc)
        entry.set('type', 'section')
        entry.set('label', 'Section')
        entry.set('parentId', 'parent')
        entry.delete('listing')
      },
    ],
    ['invalid listing', (doc) => rawEntry(doc).set('listing', {})],
    [
      'padded id',
      (doc) => {
        const items = rawItems(doc)
        const [id, entry] = items.entries().next().value!
        const clone = entry.clone()
        items.delete(id)
        items.set(` ${id}`, clone)
      },
    ],
    ['padded parentId', (doc) => rawEntry(doc).set('parentId', ' section-1 ')],
    ['legacy nested listing id', (doc) => rawEntry(doc).set('id', 'listing-1')],
    ['non-map value', (doc) => (rawItems(doc) as Y.Map<unknown>).set('broken', 'not-a-map')],
  ]

  it.each(invalidRawEntries)('rejects a raw %s entry', (_label, mutate) => {
    const doc = createDocument()
    seedWatchlist(doc, [listing('00000000-0000-4000-8000-000000000001')])
    mutate(doc)
    expect(() => getEntityFields(doc, 'watchlist')).toThrow()
  })

  it('merges concurrent additions and edits to distinct listing memberships', () => {
    const results = mergeConcurrentChanges(
      [
        listing('00000000-0000-4000-8000-000000000001'),
        listing('00000000-0000-4000-8000-000000000002', 'MSFT'),
        listing('00000000-0000-4000-8000-000000000003', 'GOOG'),
      ],
      (items) => [
        ...items.map((item) =>
          item.type === 'listing' && item.listing.listing_id === 'MSFT'
            ? listing(item.id, 'NVDA')
            : item
        ),
        listing('00000000-0000-4000-8000-000000000004', 'AAPL'),
      ],
      (items) => [
        ...items.map((item) =>
          item.type === 'listing' && item.listing.listing_id === 'GOOG'
            ? listing(item.id, 'TSLA')
            : item
        ),
        listing('00000000-0000-4000-8000-000000000005', 'AAPL'),
      ]
    )

    for (const items of results) {
      const symbols = items.flatMap((item) =>
        item.type === 'listing' ? item.listing.listing_id : []
      )
      expect(symbols.sort()).toEqual([
        '00000000-0000-4000-8000-000000000001',
        'AAPL',
        'NVDA',
        'TSLA',
      ])
    }
  })

  it.each([
    ['into its deleted destination section', null, 'section'],
    ['out of its deleted previous section', 'section', null],
  ] as const)('retains a listing moved %s', (_label, initialParent, nextParent) => {
    const sectionId = '00000000-0000-4000-8000-000000000001'
    const itemId = '00000000-0000-4000-8000-000000000002'
    const results = mergeConcurrentChanges(
      [
        { id: sectionId, type: 'section', parentId: null, label: 'Temporary' },
        {
          ...listing(itemId, 'AAPL'),
          parentId: initialParent === 'section' ? sectionId : null,
        },
      ],
      (items) => items.filter((item) => item.id !== sectionId && item.parentId !== sectionId),
      (items) =>
        items.map((item) =>
          item.id === itemId && item.type === 'listing'
            ? { ...item, parentId: nextParent === 'section' ? sectionId : null }
            : item
        )
    )

    for (const items of results) {
      expect(items).toEqual([listing(itemId, 'AAPL')])
    }
  })
})
