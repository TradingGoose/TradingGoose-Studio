import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  getDashboardColorPairMap,
  getDashboardLayoutMap,
  getDashboardWidgetMap,
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
  setDashboardColorPairDocument,
  setDashboardLayoutTopology,
  setDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { replaceDashboardPanelWidget } from '@/widgets/layout-document'

const layout = {
  layout: {
    id: 'chart-panel',
    type: 'panel' as const,
    identityId: 'chart-widget',
    widgetKey: 'data_chart' as const,
  },
}

const widget = {
  pairColor: 'red' as const,
  params: { data: { provider: 'alpaca' }, view: { interval: '1m' } },
}

const pair = {
  listing: {
    listing_type: 'default' as const,
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
  },
}

describe('dashboard Yjs document owners', () => {
  it('round-trips layout, widget, and pair state through distinct documents', () => {
    const layoutDoc = new Y.Doc()
    const widgetDoc = new Y.Doc()
    const pairDoc = new Y.Doc()
    try {
      seedDashboardLayoutSession(layoutDoc, layout)
      seedDashboardWidgetSession(widgetDoc, widget)
      seedDashboardColorPairSession(pairDoc, pair)

      expect(readDashboardLayoutDocument(layoutDoc)).toEqual(layout)
      expect(readDashboardWidgetDocument(widgetDoc, 'data_chart')).toEqual(widget)
      expect(readDashboardColorPairDocument(pairDoc)).toEqual(pair)
      expect(layoutDoc.share.has('widget')).toBe(false)
      expect(layoutDoc.share.has('colorPair')).toBe(false)
      expect(widgetDoc.share.has('layout')).toBe(false)
      expect(pairDoc.share.has('layout')).toBe(false)
    } finally {
      layoutDoc.destroy()
      widgetDoc.destroy()
      pairDoc.destroy()
    }
  })

  it('mutating one owner leaves the other documents and subscriptions untouched', () => {
    const layoutDoc = new Y.Doc()
    const widgetDoc = new Y.Doc()
    const pairDoc = new Y.Doc()
    const layoutUpdate = vi.fn()
    const pairUpdate = vi.fn()
    try {
      seedDashboardLayoutSession(layoutDoc, layout, YJS_ORIGINS.SYSTEM)
      seedDashboardWidgetSession(widgetDoc, widget, YJS_ORIGINS.SYSTEM)
      seedDashboardColorPairSession(pairDoc, pair, YJS_ORIGINS.SYSTEM)
      layoutDoc.on('update', layoutUpdate)
      pairDoc.on('update', pairUpdate)
      const layoutVector = Y.encodeStateVector(layoutDoc)
      const pairVector = Y.encodeStateVector(pairDoc)

      setDashboardWidgetDocument(
        widgetDoc,
        'data_chart',
        { ...widget, params: { ...widget.params, view: { interval: '1h' } } },
        YJS_ORIGINS.USER
      )

      expect(layoutUpdate).not.toHaveBeenCalled()
      expect(pairUpdate).not.toHaveBeenCalled()
      expect(Y.encodeStateVector(layoutDoc)).toEqual(layoutVector)
      expect(Y.encodeStateVector(pairDoc)).toEqual(pairVector)
      expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').params).toMatchObject({
        view: { interval: '1h' },
      })
    } finally {
      layoutDoc.destroy()
      widgetDoc.destroy()
      pairDoc.destroy()
    }
  })

  it('a topology replacement changes only the layout binding', () => {
    const layoutDoc = new Y.Doc()
    const widgetDoc = new Y.Doc()
    try {
      seedDashboardLayoutSession(layoutDoc, layout)
      seedDashboardWidgetSession(widgetDoc, widget)
      const widgetVector = Y.encodeStateVector(widgetDoc)
      const plan = replaceDashboardPanelWidget(layout.layout, 'chart-panel', 'watchlist')

      setDashboardLayoutTopology(layoutDoc, plan.layout, YJS_ORIGINS.USER)

      const next = readDashboardLayoutDocument(layoutDoc).layout
      expect(next).toMatchObject({ widgetKey: 'watchlist' })
      expect(Y.encodeStateVector(widgetDoc)).toEqual(widgetVector)
      expect(getDashboardLayoutMap(layoutDoc).has('topology')).toBe(true)
      expect(getDashboardWidgetMap(layoutDoc).size).toBe(0)
    } finally {
      layoutDoc.destroy()
      widgetDoc.destroy()
    }
  })

  it('color-pair edits never update their subscribing widget document', () => {
    const widgetDoc = new Y.Doc()
    const pairDoc = new Y.Doc()
    try {
      seedDashboardWidgetSession(widgetDoc, widget)
      seedDashboardColorPairSession(pairDoc, pair)
      const widgetVector = Y.encodeStateVector(widgetDoc)

      setDashboardColorPairDocument(
        pairDoc,
        { ...pair, watchlistId: 'watchlist-1' },
        YJS_ORIGINS.USER
      )

      expect(Y.encodeStateVector(widgetDoc)).toEqual(widgetVector)
      expect(readDashboardColorPairDocument(pairDoc)).toMatchObject({
        watchlistId: 'watchlist-1',
      })
      expect(getDashboardColorPairMap(pairDoc).has('watchlistId')).toBe(true)
    } finally {
      widgetDoc.destroy()
      pairDoc.destroy()
    }
  })
})
