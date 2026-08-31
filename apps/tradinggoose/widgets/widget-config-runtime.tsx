'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type * as Y from 'yjs'
import { buildDashboardWidgetDescriptor } from '@/lib/copilot/review-sessions/identity'
import {
  applyDashboardColorPairDocumentDelta,
  applyDashboardWidgetDocumentDelta,
  getDashboardWidgetMap,
  readDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { useDashboardColorPair } from '@/lib/yjs/use-dashboard-color-pair'
import { useYjsTargetSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { LinkedPairColor, WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDocument } from '@/widgets/layout-document'
import type { PairColor } from '@/widgets/pair-colors'
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
  loadFailure: 'widget' | 'pair' | null
  isRetrying: boolean
  retry: () => void
  writeWidget: (baseline: DashboardWidgetDocument, target: DashboardWidgetDocument) => void
  writePair: (baseline: PairColorContext, target: PairColorContext) => void
  changePairColor?: (pairColor: PairColor) => void
}

const WidgetConfigRuntimeContext = createContext<WidgetConfigRuntime | null>(null)
const EMPTY_PAIR_CONTEXT: PairColorContext = {}

type PendingPairChange = {
  scope: string
  targetPairColor: PairColor
}

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
  const pairColor = widget?.pairColor ?? 'gray'
  const pairSession = useDashboardColorPair({
    workspaceId,
    ownerUserId,
    layoutId,
    pairColor,
    failureMessage: 'Failed to open color pair',
  })
  const pairDoc = pairSession.doc
  const pairContext = pairSession.context
  const [pendingPairChange, setPendingPairChange] = useState<PendingPairChange | null>(null)
  const pairChangeScope = `${identityId}:${widgetKey ?? ''}`
  const pendingTargetPairColor = pendingPairChange?.targetPairColor ?? 'gray'
  const targetPairSession = useDashboardColorPair({
    workspaceId,
    ownerUserId,
    layoutId,
    pairColor: pendingTargetPairColor,
    failureMessage: 'Failed to open destination color pair',
  })
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
  const changePairColor = useCallback(
    (targetPairColor: PairColor) => {
      if (
        pendingPairChange ||
        !widgetDoc ||
        !widget ||
        !isWidgetKey(widgetKey) ||
        targetPairColor === pairColor ||
        (pairColor !== 'gray' && !pairDoc)
      ) {
        return
      }
      setPendingPairChange({
        scope: pairChangeScope,
        targetPairColor,
      })
    },
    [pairChangeScope, pairColor, pairDoc, pendingPairChange, widget, widgetDoc, widgetKey]
  )

  useEffect(() => {
    const pending = pendingPairChange
    if (!pending) return
    if (
      pending.scope !== pairChangeScope ||
      pending.targetPairColor === pairColor ||
      !widgetDoc ||
      !widget ||
      !isWidgetKey(widgetKey)
    ) {
      setPendingPairChange(null)
      return
    }
    if (targetPairSession.error) return
    if (pending.targetPairColor !== 'gray' && !targetPairSession.doc) return

    const pairs = [] as Array<{ color: LinkedPairColor } & PairColorContext>
    if (pairColor !== 'gray') pairs.push({ ...pairContext, color: pairColor })
    if (pending.targetPairColor !== 'gray') {
      pairs.push({ ...targetPairSession.context, color: pending.targetPairColor })
    }
    const next = applyWidgetConfigMutation({
      origin: 'human',
      widgetKey,
      widget,
      colorPairs: { pairs },
      patch: { pairColor: pending.targetPairColor },
    })

    const targetPairChange = next.colorPairDiff.find(
      (change) => change.color === pending.targetPairColor
    )
    if (targetPairChange && targetPairSession.doc) {
      applyDashboardColorPairDocumentDelta(
        targetPairSession.doc,
        targetPairChange.before,
        targetPairChange.after,
        YJS_ORIGINS.USER
      )
    }
    if (next.widgetChanged) {
      writeWidget(widget, next.widgetDocument)
    }
    setPendingPairChange((current) => (current === pending ? null : current))
  }, [
    pairColor,
    pairChangeScope,
    pairContext,
    pendingPairChange,
    targetPairSession.context,
    targetPairSession.doc,
    targetPairSession.error,
    widget,
    widgetDoc,
    widgetKey,
    writeWidget,
  ])
  const retry = useCallback(() => {
    if (widgetSession.error) widgetSession.retry()
    if (pairSession.error) pairSession.retry()
    if (targetPairSession.error) targetPairSession.retry()
  }, [
    pairSession.error,
    pairSession.retry,
    targetPairSession.error,
    targetPairSession.retry,
    widgetSession.error,
    widgetSession.retry,
  ])
  const value = useMemo<WidgetConfigRuntime>(
    () => ({
      widgetKey,
      widget,
      pairContext,
      isWidgetReady,
      isPairReady,
      loadFailure: widgetSession.error
        ? 'widget'
        : pairSession.error || targetPairSession.error
          ? 'pair'
          : null,
      isRetrying:
        widgetSession.isRetrying || pairSession.isRetrying || targetPairSession.isRetrying,
      retry,
      writeWidget,
      writePair,
      changePairColor: pendingPairChange ? undefined : changePairColor,
    }),
    [
      isPairReady,
      isWidgetReady,
      pairContext,
      pairSession.error,
      pairSession.isRetrying,
      pendingPairChange,
      retry,
      targetPairSession.error,
      targetPairSession.isRetrying,
      widget,
      widgetKey,
      widgetSession.error,
      widgetSession.isRetrying,
      changePairColor,
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
      loadFailure: null,
      isRetrying: false,
      retry: () => undefined,
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
    const pairColor = runtime.widget?.pairColor ?? 'gray'
    const linkedOwnerReady = widgetOwnerReady && (pairColor === 'gray' || runtime.isPairReady)
    const apply = (
      patch: Parameters<typeof applyWidgetConfigMutation>[0]['patch'],
      requireLinkedOwner = false
    ) => {
      if (!widgetOwnerReady || !runtime.widget || !isWidgetKey(runtime.widgetKey)) return
      const color = runtime.widget.pairColor
      if (requireLinkedOwner && color !== 'gray' && !runtime.isPairReady) return
      const next = applyWidgetConfigMutation({
        origin: 'human',
        widgetKey: runtime.widgetKey,
        widget: runtime.widget,
        colorPairs:
          color === 'gray' ? { pairs: [] } : { pairs: [{ color, ...runtime.pairContext }] },
        patch,
      })
      if (next.widgetChanged) {
        runtime.writeWidget(runtime.widget, next.widgetDocument)
      }
      const pairChange = next.colorPairDiff.find((change) => change.color === color)
      if (pairChange && color !== 'gray') {
        runtime.writePair(pairChange.before, pairChange.after)
      }
    }
    return {
      changeWidgetPairColor: linkedOwnerReady ? runtime.changePairColor : undefined,
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
  loadFailure: 'widget' | 'pair' | null
  isRetrying: boolean
  retry: () => void
} => {
  const {
    widgetKey,
    widget,
    pairContext,
    isWidgetReady,
    isPairReady,
    loadFailure,
    isRetrying,
    retry,
  } = useWidgetConfigRuntime()
  const isEffectiveParamsReady = isWidgetReady && isPairReady
  const pairColor = widget?.pairColor ?? 'gray'
  if (!isEffectiveParamsReady || !widget || !isWidgetKey(widgetKey)) {
    return {
      renderWidget: null,
      widgetKey,
      pairColor,
      isWidgetReady,
      isEffectiveParamsReady,
      loadFailure,
      isRetrying,
      retry,
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
    loadFailure,
    isRetrying,
    retry,
  }
}
