import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { normalizeWatchlistDocumentContent } from '@/lib/watchlists/validation'
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
    ['dangling parentId', (doc) => rawEntry(doc).set('parentId', 'section-1')],
    [
      'duplicate canonical listing',
      (doc) => rawItems(doc).set('00000000-0000-4000-8000-000000000002', rawEntry(doc).clone()),
    ],
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

  it('merges concurrent item additions without replacing either collaborator row', () => {
    const source = new Y.Doc()
    const left = new Y.Doc()
    const right = new Y.Doc()
    try {
      seedEntitySession(source, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [listing('00000000-0000-4000-8000-000000000001')],
        },
      })
      const state = Y.encodeStateAsUpdate(source)
      Y.applyUpdate(left, state)
      Y.applyUpdate(right, state)
      const leftBase = Y.encodeStateVector(left)
      const rightBase = Y.encodeStateVector(right)

      updateWatchlistItems(left, (items) => [
        ...items,
        listing('00000000-0000-4000-8000-000000000002'),
      ])
      updateWatchlistItems(right, (items) => [
        ...items,
        listing('00000000-0000-4000-8000-000000000003'),
      ])
      const leftUpdate = Y.encodeStateAsUpdate(left, leftBase)
      const rightUpdate = Y.encodeStateAsUpdate(right, rightBase)
      Y.applyUpdate(left, rightUpdate)
      Y.applyUpdate(right, leftUpdate)

      const expected = [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ]
      expect(
        readWatchlistItems(left)
          .map((item) => item.id)
          .sort()
      ).toEqual(expected)
      expect(
        readWatchlistItems(right)
          .map((item) => item.id)
          .sort()
      ).toEqual(expected)
      expect(left.getMap('fields').get('items')).toBeInstanceOf(Y.Map)
    } finally {
      source.destroy()
      left.destroy()
      right.destroy()
    }
  })

  it('keeps the same listing distinct when it belongs to different sections', () => {
    const doc = new Y.Doc()
    const firstSection = '00000000-0000-4000-8000-000000000001'
    const secondSection = '00000000-0000-4000-8000-000000000002'
    try {
      seedEntitySession(doc, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [
            { id: firstSection, type: 'section', parentId: null, label: 'First' },
            { id: secondSection, type: 'section', parentId: null, label: 'Second' },
            { ...listing('00000000-0000-4000-8000-000000000003', 'AAPL'), parentId: firstSection },
            { ...listing('00000000-0000-4000-8000-000000000004', 'AAPL'), parentId: secondSection },
          ],
        },
      })

      expect(readWatchlistItems(doc).filter((item) => item.type === 'listing')).toHaveLength(2)
    } finally {
      doc.destroy()
    }
  })

  it('merges concurrent edits to different listing rows', () => {
    const source = new Y.Doc()
    const left = new Y.Doc()
    const right = new Y.Doc()
    const firstId = '00000000-0000-4000-8000-000000000001'
    const secondId = '00000000-0000-4000-8000-000000000002'
    try {
      seedEntitySession(source, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [listing(firstId, 'AAPL'), listing(secondId, 'MSFT')],
        },
      })
      const state = Y.encodeStateAsUpdate(source)
      Y.applyUpdate(left, state)
      Y.applyUpdate(right, state)
      const leftBase = Y.encodeStateVector(left)
      const rightBase = Y.encodeStateVector(right)

      updateWatchlistItems(left, (items) =>
        items.map((item) => (item.id === firstId ? listing(firstId, 'GOOG') : item))
      )
      updateWatchlistItems(right, (items) =>
        items.map((item) => (item.id === secondId ? listing(secondId, 'NVDA') : item))
      )
      const leftUpdate = Y.encodeStateAsUpdate(left, leftBase)
      const rightUpdate = Y.encodeStateAsUpdate(right, rightBase)
      Y.applyUpdate(left, rightUpdate)
      Y.applyUpdate(right, leftUpdate)

      const symbols = (doc: Y.Doc) =>
        readWatchlistItems(doc).map((item) =>
          item.type === 'listing' ? item.listing.listing_id : ''
        )
      expect(symbols(left)).toEqual(['GOOG', 'NVDA'])
      expect(symbols(right)).toEqual(['GOOG', 'NVDA'])
    } finally {
      source.destroy()
      left.destroy()
      right.destroy()
    }
  })

  it('merges a concurrent move and listing edit into the same durable item', () => {
    const source = new Y.Doc()
    const left = new Y.Doc()
    const right = new Y.Doc()
    const firstSection = '00000000-0000-4000-8000-000000000001'
    const secondSection = '00000000-0000-4000-8000-000000000002'
    const itemId = '00000000-0000-4000-8000-000000000003'
    try {
      seedEntitySession(source, {
        entityKind: 'watchlist',
        payload: {
          settings: { showLogo: true, showTicker: true, showDescription: true },
          items: [
            { id: firstSection, type: 'section', parentId: null, label: 'First' },
            { id: secondSection, type: 'section', parentId: null, label: 'Second' },
            { ...listing(itemId, 'AAPL'), parentId: firstSection },
          ],
        },
      })
      const state = Y.encodeStateAsUpdate(source)
      Y.applyUpdate(left, state)
      Y.applyUpdate(right, state)
      const leftBase = Y.encodeStateVector(left)
      const rightBase = Y.encodeStateVector(right)

      updateWatchlistItems(left, (items) =>
        items.map((item) =>
          item.id === itemId && item.type === 'listing'
            ? { ...item, parentId: secondSection }
            : item
        )
      )
      updateWatchlistItems(right, (items) =>
        items.map((item) =>
          item.id === itemId ? { ...listing(itemId, 'GOOG'), parentId: firstSection } : item
        )
      )
      const leftUpdate = Y.encodeStateAsUpdate(left, leftBase)
      const rightUpdate = Y.encodeStateAsUpdate(right, rightBase)
      Y.applyUpdate(left, rightUpdate)
      Y.applyUpdate(right, leftUpdate)

      for (const doc of [left, right]) {
        const item = readWatchlistItems(doc).find((entry) => entry.id === itemId)
        expect(item).toMatchObject({
          id: itemId,
          type: 'listing',
          parentId: secondSection,
          listing: { listing_id: 'GOOG' },
        })
        const rawItems = doc.getMap('fields').get('items') as Y.Map<Y.Map<unknown>>
        expect(rawItems.get(itemId)?.has('id')).toBe(false)
        expect(
          normalizeWatchlistDocumentContent({
            settings: { showLogo: true, showTicker: true, showDescription: true },
            items: readWatchlistItems(doc),
          }).items
        ).toHaveLength(3)
      }
    } finally {
      source.destroy()
      left.destroy()
      right.destroy()
    }
  })
})
