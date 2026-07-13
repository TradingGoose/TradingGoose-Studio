import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  applyDashboardColorPairDocumentDelta,
  applyDashboardWidgetDocumentDelta,
  getDashboardLayoutMap,
  getDashboardWidgetMap,
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
  setDashboardLayoutTopology,
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
      expect(getDashboardWidgetMap(widgetDoc).get('params')).toBeInstanceOf(Y.Map)
    } finally {
      layoutDoc.destroy()
      widgetDoc.destroy()
      pairDoc.destroy()
    }
  })

  it('mutating widget and color-pair owners leaves the other documents untouched', () => {
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
      const beforeWidget = readDashboardWidgetDocument(widgetDoc, 'data_chart')

      applyDashboardWidgetDocumentDelta(
        widgetDoc,
        'data_chart',
        beforeWidget,
        { ...beforeWidget, params: { ...beforeWidget.params, view: { interval: '1h' } } },
        YJS_ORIGINS.USER
      )

      expect(layoutUpdate).not.toHaveBeenCalled()
      expect(pairUpdate).not.toHaveBeenCalled()
      expect(Y.encodeStateVector(layoutDoc)).toEqual(layoutVector)
      expect(Y.encodeStateVector(pairDoc)).toEqual(pairVector)
      expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').params).toMatchObject({
        view: { interval: '1h' },
      })

      const widgetVector = Y.encodeStateVector(widgetDoc)
      const beforePair = readDashboardColorPairDocument(pairDoc)
      applyDashboardColorPairDocumentDelta(
        pairDoc,
        beforePair,
        { ...beforePair, watchlistId: 'watchlist-1' },
        YJS_ORIGINS.USER
      )

      expect(Y.encodeStateVector(layoutDoc)).toEqual(layoutVector)
      expect(Y.encodeStateVector(widgetDoc)).toEqual(widgetVector)
      expect(readDashboardColorPairDocument(pairDoc)).toMatchObject({
        watchlistId: 'watchlist-1',
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

  it.each([
    [
      'populated params',
      {
        pairColor: 'gray' as const,
        params: { data: { provider: 'alpaca' }, view: { interval: '1m' } },
      },
      { view: { interval: '1h' } },
      { data: { provider: 'polygon' } },
      { data: { provider: 'polygon' }, view: { interval: '1h' } },
    ],
    [
      'null params at distinct roots',
      { pairColor: 'gray' as const, params: null },
      { view: { interval: '1h' } },
      { data: { provider: 'polygon' } },
      { data: { provider: 'polygon' }, view: { interval: '1h' } },
    ],
    [
      'null params beneath one missing nested object',
      { pairColor: 'gray' as const, params: null },
      { view: { interval: '1h' } },
      { view: { timezone: 'UTC' } },
      { view: { interval: '1h', timezone: 'UTC' } },
    ],
  ])(
    'merges concurrent widget and color-pair field changes from %s',
    (_name, initialWidget, leftPatch, rightPatch, expectedParams) => {
      const leftWidgetDoc = new Y.Doc()
      const rightWidgetDoc = new Y.Doc()
      const leftPairDoc = new Y.Doc()
      const rightPairDoc = new Y.Doc()
      try {
        const initialPair = { workflowId: 'workflow-1' }
        seedDashboardWidgetSession(leftWidgetDoc, initialWidget)
        seedDashboardColorPairSession(leftPairDoc, initialPair)
        expect(readDashboardWidgetDocument(leftWidgetDoc, 'data_chart')).toEqual(initialWidget)
        Y.applyUpdate(rightWidgetDoc, Y.encodeStateAsUpdate(leftWidgetDoc))
        Y.applyUpdate(rightPairDoc, Y.encodeStateAsUpdate(leftPairDoc))

        const leftWidget = readDashboardWidgetDocument(leftWidgetDoc, 'data_chart')
        const rightWidget = readDashboardWidgetDocument(rightWidgetDoc, 'data_chart')
        applyDashboardWidgetDocumentDelta(leftWidgetDoc, 'data_chart', leftWidget, {
          ...leftWidget,
          params: { ...(leftWidget.params ?? {}), ...leftPatch },
        })
        applyDashboardWidgetDocumentDelta(rightWidgetDoc, 'data_chart', rightWidget, {
          ...rightWidget,
          params: { ...(rightWidget.params ?? {}), ...rightPatch },
        })

        const leftPair = readDashboardColorPairDocument(leftPairDoc)
        const rightPair = readDashboardColorPairDocument(rightPairDoc)
        applyDashboardColorPairDocumentDelta(leftPairDoc, leftPair, {
          ...leftPair,
          watchlistId: 'watchlist-1',
        })
        applyDashboardColorPairDocumentDelta(rightPairDoc, rightPair, {
          ...rightPair,
          skillId: 'skill-1',
        })

        Y.applyUpdate(leftWidgetDoc, Y.encodeStateAsUpdate(rightWidgetDoc))
        Y.applyUpdate(rightWidgetDoc, Y.encodeStateAsUpdate(leftWidgetDoc))
        Y.applyUpdate(leftPairDoc, Y.encodeStateAsUpdate(rightPairDoc))
        Y.applyUpdate(rightPairDoc, Y.encodeStateAsUpdate(leftPairDoc))

        expect(readDashboardWidgetDocument(leftWidgetDoc, 'data_chart')).toEqual({
          pairColor: 'gray',
          params: expectedParams,
        })
        expect(readDashboardWidgetDocument(rightWidgetDoc, 'data_chart')).toEqual(
          readDashboardWidgetDocument(leftWidgetDoc, 'data_chart')
        )
        expect(readDashboardColorPairDocument(leftPairDoc)).toEqual({
          workflowId: 'workflow-1',
          watchlistId: 'watchlist-1',
          skillId: 'skill-1',
        })
        expect(readDashboardColorPairDocument(rightPairDoc)).toEqual(
          readDashboardColorPairDocument(leftPairDoc)
        )
      } finally {
        leftWidgetDoc.destroy()
        rightWidgetDoc.destroy()
        leftPairDoc.destroy()
        rightPairDoc.destroy()
      }
    }
  )

  it('keeps portfolio selection atomic while merging separate widget params', () => {
    const leftDoc = new Y.Doc()
    const rightDoc = new Y.Doc()
    const account = (accountId: string) => ({
      providerId: 'alpaca',
      credentialId: `credential-${accountId}`,
      serviceId: 'alpaca-live',
      accountId,
    })
    try {
      seedDashboardWidgetSession(leftDoc, {
        pairColor: 'gray',
        params: { portfolioIdentity: account('a'), side: 'buy' },
      })
      Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc))

      const left = readDashboardWidgetDocument(leftDoc, 'quick_order')
      const right = readDashboardWidgetDocument(rightDoc, 'quick_order')
      applyDashboardWidgetDocumentDelta(leftDoc, 'quick_order', left, {
        ...left,
        params: { ...(left.params ?? {}), portfolioIdentity: account('b') },
      })
      applyDashboardWidgetDocumentDelta(rightDoc, 'quick_order', right, {
        ...right,
        params: { ...(right.params ?? {}), portfolioIdentity: account('c'), side: 'sell' },
      })

      Y.applyUpdate(leftDoc, Y.encodeStateAsUpdate(rightDoc))
      Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc))

      const merged = readDashboardWidgetDocument(leftDoc, 'quick_order')
      expect(merged.params).toMatchObject({ side: 'sell' })
      expect([account('b'), account('c')]).toContainEqual(merged.params?.portfolioIdentity)
      expect(readDashboardWidgetDocument(rightDoc, 'quick_order')).toEqual(merged)
    } finally {
      leftDoc.destroy()
      rightDoc.destroy()
    }
  })
})
