'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'
import type * as Y from 'yjs'
import {
  applyDashboardWidgetConfigPatch,
  getDashboardColorPairsMap,
  getDashboardLayoutMap,
  getDashboardWidgetsMap,
  readDashboardColorPairContext,
  readDashboardLayoutTopology,
  readDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import type { PairColorContext, PersistedColorPairsState } from '@/widgets/color-pairs'
import type { WidgetInstance } from '@/widgets/layout'
import { findDashboardTopologyPanel } from '@/widgets/layout-document'
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import { isWidgetKey, resolveEffectiveWidgetParams } from '@/widgets/widget-contracts'

type WidgetConfigRuntime = {
  doc: Y.Doc
  panelId: string
  canWrite: boolean
}

const WidgetConfigRuntimeContext = createContext<WidgetConfigRuntime | null>(null)
const EMPTY_PAIR_CONTEXT: PairColorContext = {}

export function WidgetConfigRuntimeProvider({
  children,
  doc,
  panelId,
  canWrite,
}: {
  children: ReactNode
  doc: Y.Doc
  panelId: string
  canWrite: boolean
}) {
  const value = useMemo(() => ({ doc, panelId, canWrite }), [canWrite, doc, panelId])
  return (
    <WidgetConfigRuntimeContext.Provider value={value}>
      {children}
    </WidgetConfigRuntimeContext.Provider>
  )
}

function useWidgetConfigRuntime(): WidgetConfigRuntime {
  const runtime = useContext(WidgetConfigRuntimeContext)
  if (!runtime) {
    throw new Error('Widget config runtime hooks must be used inside WidgetConfigRuntimeProvider')
  }
  return runtime
}

function readPanelWidget(doc: Y.Doc, panelId: string): WidgetInstance {
  const panel = findDashboardTopologyPanel(readDashboardLayoutTopology(doc), panelId)
  if (!panel) return null
  const widget = readDashboardWidgetDocument(doc, panel.identityId, panel.widgetKey)
  if (!widget) throw new Error(`Dashboard panel ${panelId} references a missing widget`)
  return panel.widgetKey ? { key: panel.widgetKey, ...widget } : null
}

function subscribePanelWidget(doc: Y.Doc, panelId: string, listener: () => void): () => void {
  const layout = getDashboardLayoutMap(doc)
  const widgets = getDashboardWidgetsMap(doc)
  let identityId: string | null = null
  let widget: Y.Map<unknown> | undefined

  const onWidget = () => listener()
  const bindWidget = () => {
    const panel = findDashboardTopologyPanel(readDashboardLayoutTopology(doc), panelId)
    const nextIdentityId = panel?.identityId ?? null
    const nextWidget = nextIdentityId ? widgets.get(nextIdentityId) : undefined
    if (nextWidget === widget) {
      identityId = nextIdentityId
      return
    }
    widget?.unobserve(onWidget)
    identityId = nextIdentityId
    widget = nextWidget
    widget?.observe(onWidget)
  }
  const onLayout = () => {
    bindWidget()
    listener()
  }
  const onWidgets = (event: Y.YMapEvent<Y.Map<unknown>>) => {
    if (!identityId || !event.keysChanged.has(identityId)) return
    bindWidget()
    listener()
  }

  bindWidget()
  layout.observe(onLayout)
  widgets.observe(onWidgets)
  return () => {
    layout.unobserve(onLayout)
    widgets.unobserve(onWidgets)
    widget?.unobserve(onWidget)
  }
}

function subscribeColorPair(doc: Y.Doc, color: PairColor, listener: () => void): () => void {
  if (color === 'gray') return () => {}
  const colorPairs = getDashboardColorPairsMap(doc)
  let pair = colorPairs.get(color)

  const onPair = () => listener()
  const bindPair = () => {
    const nextPair = colorPairs.get(color)
    if (nextPair === pair) return
    pair?.unobserve(onPair)
    pair = nextPair
    pair?.observe(onPair)
  }
  const onColorPairs = (event: Y.YMapEvent<Y.Map<unknown>>) => {
    if (!event.keysChanged.has(color)) return
    bindPair()
    listener()
  }

  pair?.observe(onPair)
  colorPairs.observe(onColorPairs)
  return () => {
    colorPairs.unobserve(onColorPairs)
    pair?.unobserve(onPair)
  }
}

function subscribeRenderWidget(doc: Y.Doc, panelId: string, listener: () => void): () => void {
  let unsubscribeColor = () => {}
  const bindColor = () => {
    unsubscribeColor()
    const widget = readPanelWidget(doc, panelId)
    const color = widget && isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
    unsubscribeColor = subscribeColorPair(doc, color, listener)
  }
  const unsubscribeWidget = subscribePanelWidget(doc, panelId, () => {
    bindColor()
    listener()
  })
  bindColor()
  return () => {
    unsubscribeWidget()
    unsubscribeColor()
  }
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function areWidgetInstancesEqual(left: WidgetInstance, right: WidgetInstance): boolean {
  return areJsonValuesEqual(left, right)
}

export const useWidgetPairContext = (color: PairColor) => {
  const { doc } = useWidgetConfigRuntime()
  const subscribe = useCallback(
    (listener: () => void) => subscribeColorPair(doc, color, listener),
    [color, doc]
  )
  const extract = useCallback(() => readDashboardColorPairContext(doc, color), [color, doc])
  return useYjsSubscription(subscribe, extract, EMPTY_PAIR_CONTEXT, areJsonValuesEqual)
}

export const useWidgetConfigRuntimeActions = () => {
  const { canWrite, doc, panelId } = useWidgetConfigRuntime()
  return useMemo(
    () => ({
      changeWidgetPairColor: (pairColor: PairColor) => {
        const widget = readPanelWidget(doc, panelId)
        if (!canWrite || !widget || !isWidgetKey(widget.key)) return
        applyDashboardWidgetConfigPatch(doc, panelId, { pairColor }, YJS_ORIGINS.USER)
      },
      patchWidgetParams: (params: Record<string, unknown>) => {
        if (!canWrite) return
        applyDashboardWidgetConfigPatch(
          doc,
          panelId,
          { params, paramsMode: 'patch' },
          YJS_ORIGINS.USER
        )
      },
      patchWidgetColorPair: (colorPair: Record<string, unknown> | null) => {
        const widget = readPanelWidget(doc, panelId)
        if (
          !canWrite ||
          !widget ||
          !isWidgetKey(widget.key) ||
          !isPairColor(widget.pairColor) ||
          widget.pairColor === 'gray'
        ) {
          return
        }
        applyDashboardWidgetConfigPatch(doc, panelId, { colorPair }, YJS_ORIGINS.USER)
      },
    }),
    [canWrite, doc, panelId]
  )
}

export const useWidgetLocalParams = () => {
  const { doc, panelId } = useWidgetConfigRuntime()
  const subscribe = useCallback(
    (listener: () => void) => subscribePanelWidget(doc, panelId, listener),
    [doc, panelId]
  )
  const extract = useCallback(() => readPanelWidget(doc, panelId)?.params ?? null, [doc, panelId])
  return useYjsSubscription(subscribe, extract, null, areJsonValuesEqual)
}

export const useDashboardWidgetRenderConfig = (): WidgetInstance => {
  const { doc, panelId } = useWidgetConfigRuntime()
  const subscribe = useCallback(
    (listener: () => void) => subscribeRenderWidget(doc, panelId, listener),
    [doc, panelId]
  )
  const extract = useCallback(() => {
    const widget = readPanelWidget(doc, panelId)
    if (!widget || !isWidgetKey(widget.key)) return widget
    const color = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
    const colorPairs: PersistedColorPairsState =
      color === 'gray'
        ? { pairs: [] }
        : { pairs: [{ color, ...readDashboardColorPairContext(doc, color) }] }
    return { ...widget, params: resolveEffectiveWidgetParams(widget, colorPairs) }
  }, [doc, panelId])
  return useYjsSubscription(subscribe, extract, null, areWidgetInstancesEqual)
}
