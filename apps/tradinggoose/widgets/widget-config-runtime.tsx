'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'
import type * as Y from 'yjs'
import {
  buildDashboardColorPairDescriptor,
  buildDashboardWidgetDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import {
  applyDashboardColorPairDocumentDelta,
  applyDashboardWidgetDocumentDelta,
  getDashboardColorPairMap,
  getDashboardWidgetMap,
  readDashboardColorPairDocument,
  readDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { useYjsTargetSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDocument } from '@/widgets/layout-document'
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import {
  isWidgetKey,
  normalizeWidgetColorPairPatch,
  resolveEffectiveWidgetParams,
} from '@/widgets/widget-contracts'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'

type WidgetConfigRuntime = {
  widgetKey: string | null
  widget: DashboardWidgetDocument | null
  pairContext: PairColorContext
  isWidgetReady: boolean
  isPairReady: boolean
  error: string | null
  writeWidget: (baseline: DashboardWidgetDocument, target: DashboardWidgetDocument) => void
  writePair: (baseline: PairColorContext, target: PairColorContext) => void
}

const WidgetConfigRuntimeContext = createContext<WidgetConfigRuntime | null>(null)
const EMPTY_PAIR_CONTEXT: PairColorContext = {}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

export function WidgetConfigRuntimeProvider({
  children,
  workspaceId,
  ownerUserId,
  layoutId,
  identityId,
  widgetKey,
}: {
  children: ReactNode
  workspaceId: string
  ownerUserId: string
  layoutId: string
  identityId: string
  widgetKey: string | null
}) {
  const widgetDescriptor = useMemo(
    () =>
      buildDashboardWidgetDescriptor({
        layoutId,
        identityId,
        workspaceId,
        ownerUserId,
      }),
    [identityId, layoutId, ownerUserId, workspaceId]
  )
  const widgetSession = useYjsTargetSession(widgetDescriptor, 'write', 'Failed to open widget')
  const widgetDoc = widgetSession.doc
  const subscribeWidget = useMemo(() => {
    if (!widgetDoc) return (_listener: () => void) => () => {}
    const map = getDashboardWidgetMap(widgetDoc)
    return (listener: () => void) => {
      const onChange = () => listener()
      map.observeDeep(onChange)
      return () => map.unobserveDeep(onChange)
    }
  }, [widgetDoc])
  const readWidget = useCallback(() => {
    if (!widgetDoc || !isWidgetKey(widgetKey)) return null
    return readDashboardWidgetDocument(widgetDoc, widgetKey)
  }, [widgetDoc, widgetKey])
  const widget = useYjsSubscription(subscribeWidget, readWidget, null, areJsonValuesEqual)
  const pairColor = widget && isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  const pairDescriptor = useMemo(
    () =>
      pairColor === 'gray'
        ? null
        : buildDashboardColorPairDescriptor({
            layoutId,
            color: pairColor,
            workspaceId,
            ownerUserId,
          }),
    [layoutId, ownerUserId, pairColor, workspaceId]
  )
  const pairSession = useYjsTargetSession(pairDescriptor, 'write', 'Failed to open color pair')
  const pairDoc = pairSession.doc
  const subscribePair = useMemo(() => {
    if (!pairDoc) return (_listener: () => void) => () => {}
    const map = getDashboardColorPairMap(pairDoc)
    return (listener: () => void) => {
      const onChange = () => listener()
      map.observeDeep(onChange)
      return () => map.unobserveDeep(onChange)
    }
  }, [pairDoc])
  const readPair = useCallback(
    () => (pairDoc ? readDashboardColorPairDocument(pairDoc) : EMPTY_PAIR_CONTEXT),
    [pairDoc]
  )
  const pairContext = useYjsSubscription(
    subscribePair,
    readPair,
    EMPTY_PAIR_CONTEXT,
    areJsonValuesEqual
  )
  const isWidgetReady = Boolean(widgetDoc)
  const isPairReady = pairColor === 'gray' || Boolean(pairDoc)
  const writeWidget = useCallback(
    (baseline: DashboardWidgetDocument, target: DashboardWidgetDocument) => {
      if (!widgetDoc || !isWidgetKey(widgetKey)) return
      applyDashboardWidgetDocumentDelta(widgetDoc, widgetKey, baseline, target, YJS_ORIGINS.USER)
    },
    [widgetDoc, widgetKey]
  )
  const writePair = useCallback(
    (baseline: PairColorContext, target: PairColorContext) => {
      if (!pairDoc) return
      applyDashboardColorPairDocumentDelta(pairDoc, baseline, target, YJS_ORIGINS.USER)
    },
    [pairDoc]
  )
  const value = useMemo(
    () => ({
      widgetKey,
      widget,
      pairContext,
      isWidgetReady,
      isPairReady,
      error: widgetSession.error ?? pairSession.error,
      writeWidget,
      writePair,
    }),
    [
      isPairReady,
      isWidgetReady,
      pairContext,
      pairSession.error,
      widget,
      widgetKey,
      widgetSession.error,
      writePair,
      writeWidget,
    ]
  )
  return (
    <WidgetConfigRuntimeContext.Provider value={value}>
      {children}
    </WidgetConfigRuntimeContext.Provider>
  )
}

export function LocalWidgetConfigRuntimeProvider({
  children,
  doc,
  widgetKey,
}: {
  children: ReactNode
  doc: Y.Doc
  widgetKey: string | null
}) {
  const subscribe = useMemo(() => {
    const map = getDashboardWidgetMap(doc)
    return (listener: () => void) => {
      const onChange = () => listener()
      map.observeDeep(onChange)
      return () => map.unobserveDeep(onChange)
    }
  }, [doc])
  const read = useCallback(
    () =>
      widgetKey === null || isWidgetKey(widgetKey)
        ? readDashboardWidgetDocument(doc, widgetKey)
        : null,
    [doc, widgetKey]
  )
  const widget = useYjsSubscription(subscribe, read, null, areJsonValuesEqual)
  const writeWidget = useCallback(
    (baseline: DashboardWidgetDocument, target: DashboardWidgetDocument) => {
      if (isWidgetKey(widgetKey)) {
        applyDashboardWidgetDocumentDelta(doc, widgetKey, baseline, target, YJS_ORIGINS.USER)
      }
    },
    [doc, widgetKey]
  )
  const value = useMemo<WidgetConfigRuntime>(
    () => ({
      widgetKey,
      widget,
      pairContext: EMPTY_PAIR_CONTEXT,
      isWidgetReady: true,
      isPairReady: true,
      error: null,
      writeWidget,
      writePair: () => undefined,
    }),
    [widget, widgetKey, writeWidget]
  )
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

export const useWidgetConfigRuntimeActions = () => {
  const runtime = useWidgetConfigRuntime()
  return useMemo(() => {
    const widgetOwnerReady =
      runtime.isWidgetReady && runtime.widget !== null && isWidgetKey(runtime.widgetKey)
    const pairColor =
      runtime.widget && isPairColor(runtime.widget.pairColor) ? runtime.widget.pairColor : 'gray'
    const linkedOwnerReady = widgetOwnerReady && (pairColor === 'gray' || runtime.isPairReady)
    const apply = (
      patch: Parameters<typeof applyWidgetConfigMutation>[0]['patch'],
      requireLinkedOwner = false
    ) => {
      if (!widgetOwnerReady || !runtime.widget || !isWidgetKey(runtime.widgetKey)) return
      const color = isPairColor(runtime.widget.pairColor) ? runtime.widget.pairColor : 'gray'
      if (requireLinkedOwner && color !== 'gray' && !runtime.isPairReady) return
      const next = applyWidgetConfigMutation({
        origin: 'human',
        widgetKey: runtime.widgetKey,
        widget: runtime.widget,
        colorPairs:
          color === 'gray' ? { pairs: [] } : { pairs: [{ color, ...runtime.pairContext }] },
        panelId: '',
        patch,
      })
      if (next.changedPaths.some((path) => path.startsWith('widget.'))) {
        runtime.writeWidget(runtime.widget, next.widgetDocument)
      }
      const pairChange = next.colorPairDiff.find((change) => change.color === color)
      if (pairChange && color !== 'gray') {
        runtime.writePair(pairChange.before, pairChange.after)
      }
    }
    return {
      changeWidgetPairColor: widgetOwnerReady
        ? (nextPairColor: PairColor) => apply({ pairColor: nextPairColor })
        : undefined,
      patchWidgetParams: widgetOwnerReady
        ? (params: Record<string, unknown>) => apply({ params })
        : undefined,
      patchWidgetLinkedParams: linkedOwnerReady
        ? (params: Record<string, unknown>) => {
            if (!runtime.widget || !isWidgetKey(runtime.widgetKey)) return
            const linkedParams = normalizeWidgetColorPairPatch(runtime.widgetKey, params)
            apply(
              pairColor === 'gray' ? { params: linkedParams } : { colorPair: linkedParams },
              true
            )
          }
        : undefined,
    }
  }, [runtime])
}

export const useWidgetLocalParams = () => useWidgetConfigRuntime().widget?.params ?? null

export const useDashboardWidgetRenderState = (): {
  renderWidget: WidgetInstance
  widgetKey: string | null
  pairColor: PairColor
  isWidgetReady: boolean
  isEffectiveParamsReady: boolean
  error: string | null
} => {
  const { widgetKey, widget, pairContext, isWidgetReady, isPairReady, error } =
    useWidgetConfigRuntime()
  const isEffectiveParamsReady = isWidgetReady && isPairReady
  const pairColor = widget && isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  if (!isEffectiveParamsReady || !widget || !isWidgetKey(widgetKey)) {
    return {
      renderWidget: null,
      widgetKey,
      pairColor,
      isWidgetReady,
      isEffectiveParamsReady,
      error,
    }
  }
  return {
    renderWidget: {
      key: widgetKey,
      ...widget,
      params: resolveEffectiveWidgetParams(
        { key: widgetKey, ...widget },
        pairColor === 'gray' ? { pairs: [] } : { pairs: [{ color: pairColor, ...pairContext }] }
      ),
    },
    widgetKey,
    pairColor,
    isWidgetReady,
    isEffectiveParamsReady,
    error,
  }
}
