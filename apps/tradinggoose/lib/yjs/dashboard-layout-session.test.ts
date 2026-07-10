import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  applyDashboardTopologyMutation,
  applyDashboardWidgetConfigPatch,
  applyDashboardWidgetMutation,
  getDashboardColorPairsMap,
  getDashboardLayoutMap,
  getDashboardWidgetsMap,
  readDashboardLayoutContent,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
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

      applyDashboardWidgetMutation(doc, {
        identityId: 'chart-widget',
        widget: {
          pairColor: 'red',
          params: { data: { provider: 'polygon' }, view: { interval: '1m' } },
        },
      })

      expect(onWidgets).toHaveBeenCalled()
      expect(onLayout).not.toHaveBeenCalled()
      expect(onColorPairs).not.toHaveBeenCalled()
    } finally {
      doc.destroy()
    }
  })

  it('keeps browser widget-parameter patches out of the layout map', () => {
    const doc = new Y.Doc()
    try {
      seedDashboardLayoutSession(doc, content())
      const onLayout = vi.fn()
      getDashboardLayoutMap(doc).observeDeep(onLayout)

      applyDashboardWidgetConfigPatch(doc, 'chart-panel', {
        params: { view: { interval: '1h' } },
      })

      expect(onLayout).not.toHaveBeenCalled()
      expect(readDashboardLayoutContent(doc).widgets['chart-widget']?.params).toMatchObject({
        view: { interval: '1h' },
      })
    } finally {
      doc.destroy()
    }
  })

  it('applies layout-owned widget replacement atomically across topology and child maps', () => {
    const doc = new Y.Doc()
    try {
      seedDashboardLayoutSession(doc, content())
      const plan = replaceDashboardPanelWidget(
        readDashboardLayoutContent(doc),
        'chart-panel',
        'watchlist'
      )
      applyDashboardTopologyMutation(doc, plan)

      const next = readDashboardLayoutContent(doc)
      if (next.layout.type !== 'panel') throw new Error('Expected panel layout')
      expect(next.layout.widgetKey).toBe('watchlist')
      expect(next.layout.identityId).not.toBe('chart-widget')
      expect(getDashboardWidgetsMap(doc).has('chart-widget')).toBe(false)
      expect(getDashboardWidgetsMap(doc).has(next.layout.identityId!)).toBe(true)
    } finally {
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
