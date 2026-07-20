import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  getEntityFields,
  getEntityListMembers,
  readWatchlistItems,
  replaceEntityListSessionMembers,
  seedEntitySession,
  updateWatchlistItems,
} from './entity-session'

describe('entity list sessions', () => {
  it('orders duplicate names deterministically by id', () => {
    const doc = new Y.Doc()
    try {
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
    } finally {
      doc.destroy()
    }
  })

  it('orders dashboard layouts by tab order', () => {
    const doc = new Y.Doc()
    try {
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

      expect(
        getEntityListMembers(doc, 'dashboard_layout').map((member) => member.entityId)
      ).toEqual(['layout-a', 'layout-c', 'layout-b'])
    } finally {
      doc.destroy()
    }
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
    const doc = new Y.Doc()
    try {
      const id = '00000000-0000-4000-8000-000000000001'
      seedEntitySession(doc, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [listing(id)],
        },
      })
      mutate(doc)
      expect(() => getEntityFields(doc, 'watchlist')).toThrow()
    } finally {
      doc.destroy()
    }
  })

  it('merges concurrent additions and edits to distinct listing memberships', () => {
    const source = new Y.Doc()
    const left = new Y.Doc()
    const right = new Y.Doc()
    try {
      seedEntitySession(source, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [
            listing('00000000-0000-4000-8000-000000000001'),
            listing('00000000-0000-4000-8000-000000000002', 'MSFT'),
            listing('00000000-0000-4000-8000-000000000003', 'GOOG'),
          ],
        },
      })
      const state = Y.encodeStateAsUpdate(source)
      Y.applyUpdate(left, state)
      Y.applyUpdate(right, state)
      const leftBase = Y.encodeStateVector(left)
      const rightBase = Y.encodeStateVector(right)

      updateWatchlistItems(left, (items) => [
        ...items.map((item) =>
          item.type === 'listing' && item.listing.listing_id === 'MSFT'
            ? listing(item.id, 'NVDA')
            : item
        ),
        listing('00000000-0000-4000-8000-000000000004', 'AAPL'),
      ])
      updateWatchlistItems(right, (items) => [
        ...items.map((item) =>
          item.type === 'listing' && item.listing.listing_id === 'GOOG'
            ? listing(item.id, 'TSLA')
            : item
        ),
        listing('00000000-0000-4000-8000-000000000005', 'AAPL'),
      ])
      const leftUpdate = Y.encodeStateAsUpdate(left, leftBase)
      const rightUpdate = Y.encodeStateAsUpdate(right, rightBase)
      Y.applyUpdate(left, rightUpdate)
      Y.applyUpdate(right, leftUpdate)

      for (const doc of [left, right]) {
        const symbols = readWatchlistItems(doc).flatMap((item) =>
          item.type === 'listing' ? item.listing.listing_id : []
        )
        expect(symbols.sort()).toEqual([
          '00000000-0000-4000-8000-000000000001',
          'AAPL',
          'NVDA',
          'TSLA',
        ])
      }
    } finally {
      source.destroy()
      left.destroy()
      right.destroy()
    }
  })

  it('retains a concurrently moved listing at root when its destination section is deleted', () => {
    const source = new Y.Doc()
    const left = new Y.Doc()
    const right = new Y.Doc()
    const sectionId = '00000000-0000-4000-8000-000000000001'
    const itemId = '00000000-0000-4000-8000-000000000002'
    try {
      seedEntitySession(source, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [
            { id: sectionId, type: 'section', parentId: null, label: 'Temporary' },
            listing(itemId, 'AAPL'),
          ],
        },
      })
      const state = Y.encodeStateAsUpdate(source)
      Y.applyUpdate(left, state)
      Y.applyUpdate(right, state)
      const leftBase = Y.encodeStateVector(left)
      const rightBase = Y.encodeStateVector(right)

      updateWatchlistItems(left, (items) => items.filter((item) => item.id !== sectionId))
      updateWatchlistItems(right, (items) =>
        items.map((item) =>
          item.id === itemId && item.type === 'listing' ? { ...item, parentId: sectionId } : item
        )
      )
      const leftUpdate = Y.encodeStateAsUpdate(left, leftBase)
      const rightUpdate = Y.encodeStateAsUpdate(right, rightBase)
      Y.applyUpdate(left, rightUpdate)
      Y.applyUpdate(right, leftUpdate)

      for (const doc of [left, right]) {
        expect(readWatchlistItems(doc)).toEqual([listing(itemId, 'AAPL')])
      }
    } finally {
      source.destroy()
      left.destroy()
      right.destroy()
    }
  })
})
