import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  applyDashboardTopologyMutation,
  applyDashboardWidgetConfigPatch,
  beginDashboardLayoutDirtyFlush,
  completeDashboardLayoutDirtyFlush,
  ensureDashboardLayoutDirtyTracker,
  failDashboardLayoutDirtyFlush,
  getDashboardColorPairsMap,
  getDashboardLayoutMap,
  getDashboardWidgetsMap,
  isDashboardLayoutDirty,
  readDashboardLayoutContent,
  seedDashboardLayoutSession,
  setDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  type DashboardLayoutDocumentContent,
  replaceDashboardPanelWidget,
} from '@/widgets/layout-document'

const content = (): DashboardLayoutDocumentContent => ({
  layout: {
    id: 'chart-panel',
    type: 'panel',
    identityId: 'chart-widget',
    widgetKey: 'data_chart',
  },
  widgets: {
    'chart-widget': {
      pairColor: 'red',
      params: { data: { provider: 'alpaca' }, view: { interval: '1m' } },
    },
  },
  colorPairs: {
    pairs: [
      {
        color: 'red',
        listing: {
          listing_type: 'default',
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
        },
      },
    ],
  },
})

function trackedDoc(initial = content()): Y.Doc {
  const doc = new Y.Doc()
  ensureDashboardLayoutDirtyTracker(doc)
  seedDashboardLayoutSession(doc, initial, YJS_ORIGINS.SYSTEM)
  return doc
}

describe('dashboard layout Yjs session', () => {
  it('round-trips topology, widget documents, and color pairs through separate maps', () => {
    const doc = new Y.Doc()
    try {
      seedDashboardLayoutSession(doc, content())
      expect(readDashboardLayoutContent(doc)).toEqual(content())
      expect(getDashboardLayoutMap(doc).has('topology')).toBe(true)
      expect(getDashboardWidgetsMap(doc).has('chart-widget')).toBe(true)
      expect(getDashboardColorPairsMap(doc).has('red')).toBe(true)
      expect(doc.share.has('fields')).toBe(false)
    } finally {
      doc.destroy()
    }
  })

  it('keeps system-origin bootstrap outside the durable dirty generations', () => {
    const doc = trackedDoc()
    try {
      expect(isDashboardLayoutDirty(doc)).toBe(false)
      expect(beginDashboardLayoutDirtyFlush(doc)).toBeNull()
    } finally {
      doc.destroy()
    }
  })

  it('tracks deep changes and deletions only under their owning durable channel keys', () => {
    const doc = trackedDoc()
    try {
      const initial = readDashboardLayoutContent(doc)
      setDashboardLayoutTopology(
        doc,
        { ...initial.layout, id: 'chart-panel-renamed' },
        YJS_ORIGINS.USER
      )
      const layoutBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(layoutBatch).toMatchObject({ generation: 1, layout: true })
      expect([...layoutBatch!.widgetIdentityIds]).toEqual([])
      expect([...layoutBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, layoutBatch!)

      getDashboardWidgetsMap(doc)
        .get('chart-widget')!
        .set('params', { data: { provider: 'polygon' }, view: { interval: '1m' } })
      const widgetBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(widgetBatch).toMatchObject({ generation: 2, layout: false })
      expect([...widgetBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...widgetBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, widgetBatch!)

      getDashboardColorPairsMap(doc).get('red')!.set('watchlistId', 'watchlist-1')
      const pairBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(pairBatch).toMatchObject({ generation: 3, layout: false })
      expect([...pairBatch!.widgetIdentityIds]).toEqual([])
      expect([...pairBatch!.pairColors]).toEqual(['red'])
      completeDashboardLayoutDirtyFlush(doc, pairBatch!)

      getDashboardColorPairsMap(doc).delete('red')
      const deletedPairBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(deletedPairBatch).toMatchObject({ generation: 4, layout: false })
      expect([...deletedPairBatch!.widgetIdentityIds]).toEqual([])
      expect([...deletedPairBatch!.pairColors]).toEqual(['red'])
      completeDashboardLayoutDirtyFlush(doc, deletedPairBatch!)

      getDashboardWidgetsMap(doc).delete('chart-widget')
      const deletedWidgetBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(deletedWidgetBatch).toMatchObject({ generation: 5, layout: false })
      expect([...deletedWidgetBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...deletedWidgetBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, deletedWidgetBatch!)
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }
  })

  it('uses one generation and one Yjs update for one logical widget-and-pair transaction', () => {
    const doc = trackedDoc()
    const onUpdate = vi.fn()
    doc.on('update', onUpdate)
    try {
      applyDashboardWidgetConfigPatch(
        doc,
        'chart-panel',
        {
          params: { data: { provider: 'polygon' }, view: { interval: '1m' } },
          colorPair: {
            listing: {
              listing_type: 'default',
              listing_id: 'MSFT',
              base_id: '',
              quote_id: '',
            },
          },
        },
        YJS_ORIGINS.USER
      )

      const batch = beginDashboardLayoutDirtyFlush(doc)
      expect(batch).toMatchObject({ generation: 1, layout: false })
      expect([...batch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...batch!.pairColors]).toEqual(['red'])
      expect(onUpdate).toHaveBeenCalledTimes(1)
      completeDashboardLayoutDirtyFlush(doc, batch!)
    } finally {
      doc.off('update', onUpdate)
      doc.destroy()
    }
  })

  it('patches widget params without mutating topology or color-pair collections', () => {
    const doc = new Y.Doc()
    try {
      const initial = content()
      seedDashboardLayoutSession(doc, initial)
      const onLayout = vi.fn()
      const onWidgets = vi.fn()
      const onColorPairs = vi.fn()
      getDashboardLayoutMap(doc).observeDeep(onLayout)
      getDashboardWidgetsMap(doc).observeDeep(onWidgets)
      getDashboardColorPairsMap(doc).observeDeep(onColorPairs)

      applyDashboardWidgetConfigPatch(doc, 'chart-panel', {
        params: { data: { provider: 'polygon' }, view: { interval: '1m' } },
      })

      expect(onWidgets).toHaveBeenCalled()
      expect(onLayout).not.toHaveBeenCalled()
      expect(onColorPairs).not.toHaveBeenCalled()
    } finally {
      doc.destroy()
    }
  })

  it('assigns params-only, pairColor-only, and explicit pair patches to their channels', () => {
    const doc = trackedDoc()
    try {
      applyDashboardWidgetConfigPatch(
        doc,
        'chart-panel',
        { params: { view: { interval: '1h' } } },
        YJS_ORIGINS.USER
      )
      const paramsBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(paramsBatch).toMatchObject({ generation: 1, layout: false })
      expect([...paramsBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...paramsBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, paramsBatch!)

      applyDashboardWidgetConfigPatch(doc, 'chart-panel', { pairColor: 'blue' }, YJS_ORIGINS.USER)
      const pairColorBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(pairColorBatch).toMatchObject({ generation: 2, layout: false })
      expect([...pairColorBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...pairColorBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, pairColorBatch!)

      applyDashboardWidgetConfigPatch(
        doc,
        'chart-panel',
        {
          colorPair: {
            listing: {
              listing_type: 'default',
              listing_id: 'MSFT',
              base_id: '',
              quote_id: '',
            },
          },
        },
        YJS_ORIGINS.USER
      )
      const explicitPairBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(explicitPairBatch).toMatchObject({ generation: 3, layout: false })
      expect([...explicitPairBatch!.widgetIdentityIds]).toEqual([])
      expect([...explicitPairBatch!.pairColors]).toEqual(['blue'])
      completeDashboardLayoutDirtyFlush(doc, explicitPairBatch!)

      const current = readDashboardLayoutContent(doc)
      expect(current.widgets['chart-widget']?.pairColor).toBe('blue')
      expect(current.widgets['chart-widget']?.params).toMatchObject({
        view: { interval: '1h' },
      })
      expect(current.colorPairs.pairs).toContainEqual({
        color: 'blue',
        listing: {
          listing_type: 'default',
          listing_id: 'MSFT',
          base_id: '',
          quote_id: '',
        },
      })
    } finally {
      doc.destroy()
    }
  })

  it('tracks widget replacement as one layout-and-widgets generation with no pair ownership', () => {
    const doc = trackedDoc()
    const onUpdate = vi.fn()
    doc.on('update', onUpdate)
    try {
      const plan = replaceDashboardPanelWidget(
        readDashboardLayoutContent(doc),
        'chart-panel',
        'watchlist'
      )
      applyDashboardTopologyMutation(doc, plan, YJS_ORIGINS.USER)

      const next = readDashboardLayoutContent(doc)
      if (next.layout.type !== 'panel') throw new Error('Expected panel layout')
      expect(next.layout.widgetKey).toBe('watchlist')
      expect(next.layout.identityId).not.toBe('chart-widget')
      expect(getDashboardWidgetsMap(doc).has('chart-widget')).toBe(false)
      expect(getDashboardWidgetsMap(doc).has(next.layout.identityId)).toBe(true)

      const batch = beginDashboardLayoutDirtyFlush(doc)
      expect(batch).toMatchObject({ generation: 1, layout: true })
      expect([...batch!.widgetIdentityIds].sort()).toEqual(
        ['chart-widget', next.layout.identityId].sort()
      )
      expect([...batch!.pairColors]).toEqual([])
      expect(onUpdate).toHaveBeenCalledTimes(1)
      completeDashboardLayoutDirtyFlush(doc, batch!)
    } finally {
      doc.off('update', onUpdate)
      doc.destroy()
    }
  })

  it('preserves a newer generation when an older in-flight batch succeeds', () => {
    const doc = trackedDoc()
    try {
      const current = readDashboardLayoutContent(doc)
      setDashboardLayoutTopology(
        doc,
        { ...current.layout, id: 'chart-panel-renamed' },
        YJS_ORIGINS.USER
      )
      const firstBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(firstBatch).toMatchObject({ generation: 1, layout: true })

      applyDashboardWidgetConfigPatch(
        doc,
        'chart-panel-renamed',
        { params: { view: { interval: '1h' } } },
        YJS_ORIGINS.USER
      )
      completeDashboardLayoutDirtyFlush(doc, firstBatch!)
      expect(isDashboardLayoutDirty(doc)).toBe(true)

      const nextBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(nextBatch).toMatchObject({ generation: 2, layout: false })
      expect([...nextBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...nextBatch!.pairColors]).toEqual([])
      completeDashboardLayoutDirtyFlush(doc, nextBatch!)
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }
  })

  it('merges a failed batch with keys dirtied by a newer generation', () => {
    const doc = trackedDoc()
    try {
      applyDashboardWidgetConfigPatch(
        doc,
        'chart-panel',
        { params: { view: { interval: '1h' } } },
        YJS_ORIGINS.USER
      )
      const failedBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(failedBatch).toMatchObject({ generation: 1, layout: false })

      getDashboardColorPairsMap(doc).get('red')!.set('watchlistId', 'watchlist-1')
      failDashboardLayoutDirtyFlush(doc, failedBatch!)
      expect(isDashboardLayoutDirty(doc)).toBe(true)

      const retryBatch = beginDashboardLayoutDirtyFlush(doc)
      expect(retryBatch).toMatchObject({ generation: 2, layout: false })
      expect([...retryBatch!.widgetIdentityIds]).toEqual(['chart-widget'])
      expect([...retryBatch!.pairColors]).toEqual(['red'])
      completeDashboardLayoutDirtyFlush(doc, retryBatch!)
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }
  })

  it('deletes empty pair contexts and keeps them absent after a Yjs round trip', () => {
    const doc = trackedDoc()
    let roundTrip: Y.Doc | null = null
    try {
      applyDashboardWidgetConfigPatch(doc, 'chart-panel', { colorPair: null }, YJS_ORIGINS.USER)

      expect(getDashboardColorPairsMap(doc).has('red')).toBe(false)
      const persisted = readDashboardLayoutContent(doc)
      expect(persisted.colorPairs).toEqual({ pairs: [] })

      const batch = beginDashboardLayoutDirtyFlush(doc)
      expect(batch).toMatchObject({ generation: 1, layout: false })
      expect([...batch!.widgetIdentityIds]).toEqual([])
      expect([...batch!.pairColors]).toEqual(['red'])
      completeDashboardLayoutDirtyFlush(doc, batch!)

      roundTrip = trackedDoc(persisted)
      expect(getDashboardColorPairsMap(roundTrip).has('red')).toBe(false)
      expect(readDashboardLayoutContent(roundTrip).colorPairs).toEqual({ pairs: [] })
      expect(isDashboardLayoutDirty(roundTrip)).toBe(false)
    } finally {
      roundTrip?.destroy()
      doc.destroy()
    }
  })

  it('rejects malformed raw widget state instead of repairing it', () => {
    const doc = new Y.Doc()
    try {
      seedDashboardLayoutSession(doc, content())
      getDashboardWidgetsMap(doc).get('chart-widget')?.set('pairColor', 'invalid')
      expect(() => readDashboardLayoutContent(doc)).toThrow()
    } finally {
      doc.destroy()
    }
  })

  it('rejects raw widget params that would be normalized by the runtime contract', () => {
    const doc = new Y.Doc()
    try {
      seedDashboardLayoutSession(doc, content())
      getDashboardWidgetsMap(doc)
        .get('chart-widget')
        ?.set('params', {
          data: { provider: 123 },
        })
      expect(() => readDashboardLayoutContent(doc)).toThrow('params must be canonical')
    } finally {
      doc.destroy()
    }
  })
})
