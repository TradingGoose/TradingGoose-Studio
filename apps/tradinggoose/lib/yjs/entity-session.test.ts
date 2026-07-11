import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
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
})
