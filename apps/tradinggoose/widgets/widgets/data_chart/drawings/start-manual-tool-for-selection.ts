import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'
import { makeUniqueDrawToolsId } from '@/widgets/widgets/data_chart/utils/draw-tools'
import { resolveRuntimePaneIndex } from '@/widgets/widgets/data_chart/utils/indicator-runtime'

type TraceDrawRouting = (event: string, details?: () => Record<string, unknown>) => void

type StartManualToolForSelectionArgs = {
  toolType: ManualToolType
  paneIndexOverride?: number | null
  pointerPaneIndexRef: MutableRefObject<number | null>
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  effectiveDrawTools: DrawToolsRef[]
  activeDrawToolsId: string | null
  activeDrawToolsRef: DrawToolsRef | null
  syncOwnersNow: (drawTools: DrawToolsRef[]) => void
  rebindOrAttachOwnerToPane: (ownerId: string, owner: DrawToolsRef, paneIndex: number) => boolean
  rebindOwnerToPane: (ownerId: string, paneIndex: number) => boolean
  startManualTool: (toolType: ManualToolType, ownerId: string) => boolean
  toManualOwnerId: (ownerRefId: string) => string
  isOwnerAttached: (ownerId: string) => boolean
  setTransientDrawTools: Dispatch<SetStateAction<DrawToolsRef[]>>
  setActiveDrawToolsId: Dispatch<SetStateAction<string | null>>
  persistDrawTools: (nextDrawTools: DrawToolsRef[]) => void
  traceDrawRouting: TraceDrawRouting
  panelId?: string
  widgetKey?: string
}

const resolveIndicatorForPaneIndex = ({
  paneIndex,
  mainPaneIndex,
  chartRef,
  indicatorRuntimeRef,
}: {
  paneIndex: number
  mainPaneIndex: number
  chartRef: MutableRefObject<IChartApi | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
}) => {
  const candidates: Array<{ indicatorId: string; score: number }> = []
  const chart = chartRef.current
  const pane =
    chart?.panes().find((candidatePane) => candidatePane.paneIndex() === paneIndex) ?? null
  const paneSeriesSet = pane ? new Set(pane.getSeries()) : null

  for (const [indicatorId, runtimeEntry] of indicatorRuntimeRef.current.entries()) {
    if (resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex) !== paneIndex) {
      continue
    }

    let score = 0
    if (runtimeEntry.errorMessage) {
      score -= 100
    }

    const plotCount = runtimeEntry.plots.length
    score += plotCount > 0 ? Math.min(10, plotCount * 2) : 0

    if (runtimeEntry.paneAnchorSeries) {
      score += 2
    }

    if (paneSeriesSet) {
      if (runtimeEntry.paneAnchorSeries && paneSeriesSet.has(runtimeEntry.paneAnchorSeries)) {
        score += 8
      }
      if (runtimeEntry.plots.some((plot) => paneSeriesSet.has(plot.series))) {
        score += 8
      }
    }

    candidates.push({ indicatorId, score })
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((left, right) => right.score - left.score)
  if (candidates[0].score < 0) {
    return null
  }
  return candidates[0].indicatorId
}

export const startManualToolForSelection = ({
  toolType,
  paneIndexOverride,
  pointerPaneIndexRef,
  chartRef,
  mainSeriesRef,
  indicatorRuntimeRef,
  effectiveDrawTools,
  activeDrawToolsId,
  activeDrawToolsRef,
  syncOwnersNow,
  rebindOrAttachOwnerToPane,
  rebindOwnerToPane,
  startManualTool,
  toManualOwnerId,
  isOwnerAttached,
  setTransientDrawTools,
  setActiveDrawToolsId,
  persistDrawTools,
  traceDrawRouting,
  panelId,
  widgetKey,
}: StartManualToolForSelectionArgs) => {
  const hasExplicitPaneOverride = typeof paneIndexOverride !== 'undefined'
  const pointerPaneIndex = hasExplicitPaneOverride ? paneIndexOverride : pointerPaneIndexRef.current
  const mainPaneIndex = mainSeriesRef.current?.getPane().paneIndex() ?? 0
  if (hasExplicitPaneOverride && pointerPaneIndex === null) {
    traceDrawRouting('start-manual-tool-missing-pane', () => ({
      toolType,
      paneIndexOverride: null,
      pointerPaneIndex: pointerPaneIndexRef.current,
    }))
    return false
  }

  const resolveIndicatorOwner = (indicatorId: string) => {
    const normalizedIndicatorId = indicatorId.trim().toLowerCase()
    return (
      effectiveDrawTools.find((entry) => {
        if (entry.pane !== 'indicator') return false
        const candidate = typeof entry.indicatorId === 'string' ? entry.indicatorId.trim() : ''
        if (!candidate) return false
        return candidate.toLowerCase() === normalizedIndicatorId
      }) ?? null
    )
  }

  const resolveOwnerForIndicatorPane = (paneIndex: number) => {
    const preferredIndicatorId = resolveIndicatorForPaneIndex({
      paneIndex,
      mainPaneIndex,
      chartRef,
      indicatorRuntimeRef,
    })
    if (!preferredIndicatorId) {
      return { indicatorId: null as string | null, owner: null as DrawToolsRef | null }
    }
    return {
      indicatorId: preferredIndicatorId,
      owner: resolveIndicatorOwner(preferredIndicatorId),
    }
  }

  const resolvePriceOwner = () =>
    effectiveDrawTools.find((entry) => entry.id === 'manual-main' && entry.pane === 'price') ??
    effectiveDrawTools.find((entry) => entry.pane === 'price') ??
    null

  const createIndicatorOwner = (indicatorId: string) => {
    const createdIndicatorOwner: DrawToolsRef = {
      id: makeUniqueDrawToolsId(`manual-${indicatorId}`, effectiveDrawTools),
      pane: 'indicator',
      indicatorId,
    }
    return createdIndicatorOwner
  }

  let targetOwner: DrawToolsRef | null = null
  let nextDrawTools = effectiveDrawTools
  let createdOwner: DrawToolsRef | null = null
  let resolvedTargetPane: 'price' | 'indicator' = 'price'
  let resolvedIndicatorId: string | null = null
  let attachRetries = 0

  if (pointerPaneIndex !== null) {
    if (pointerPaneIndex !== mainPaneIndex) {
      const indicatorResolution = resolveOwnerForIndicatorPane(pointerPaneIndex)
      if (!indicatorResolution.indicatorId) {
        traceDrawRouting('start-manual-tool-unresolved-pane', () => ({
          toolType,
          pointerPaneIndex,
          mainPaneIndex,
        }))
        return false
      }
      resolvedTargetPane = 'indicator'
      resolvedIndicatorId = indicatorResolution.indicatorId
      targetOwner = indicatorResolution.owner
      if (!targetOwner) {
        const createdIndicatorOwner = createIndicatorOwner(indicatorResolution.indicatorId)
        nextDrawTools = [...effectiveDrawTools, createdIndicatorOwner]
        targetOwner = createdIndicatorOwner
        createdOwner = createdIndicatorOwner
      }
    } else {
      resolvedTargetPane = 'price'
      resolvedIndicatorId = null
      targetOwner = resolvePriceOwner()
    }
  }

  if (!targetOwner && !hasExplicitPaneOverride && pointerPaneIndex === null && activeDrawToolsRef) {
    const isIndicatorOwnerUsable =
      activeDrawToolsRef.pane === 'indicator' &&
      typeof activeDrawToolsRef.indicatorId === 'string' &&
      activeDrawToolsRef.indicatorId.length > 0 &&
      indicatorRuntimeRef.current.has(activeDrawToolsRef.indicatorId)
    if (activeDrawToolsRef.pane === 'price' || isIndicatorOwnerUsable) {
      if (activeDrawToolsRef.pane === 'price') {
        targetOwner = resolvePriceOwner() ?? activeDrawToolsRef
        resolvedTargetPane = 'price'
        resolvedIndicatorId = null
      } else {
        targetOwner = activeDrawToolsRef
        resolvedTargetPane = 'indicator'
        resolvedIndicatorId = activeDrawToolsRef.indicatorId ?? null
      }
    }
  }

  if (!targetOwner) {
    targetOwner = resolvePriceOwner()
    resolvedTargetPane = 'price'
    resolvedIndicatorId = null
  }

  if (!targetOwner) {
    const createdPriceOwner: DrawToolsRef = {
      id: makeUniqueDrawToolsId('manual-main', effectiveDrawTools),
      pane: 'price',
    }
    nextDrawTools = [...effectiveDrawTools, createdPriceOwner]
    targetOwner = createdPriceOwner
    createdOwner = createdPriceOwner
  }

  if (!targetOwner) return false

  syncOwnersNow(nextDrawTools)
  if (createdOwner) {
    setTransientDrawTools((prev) => {
      if (prev.some((entry) => entry.id === createdOwner.id)) {
        return prev
      }
      return [...prev, createdOwner]
    })
  }

  if (nextDrawTools !== effectiveDrawTools) {
    traceDrawRouting('emit-drawtools', () => ({
      nextDrawTools,
    }))
    persistDrawTools(nextDrawTools)
  }

  if (targetOwner.id !== activeDrawToolsId) {
    setActiveDrawToolsId(targetOwner.id)
  }

  const ownerId = toManualOwnerId(targetOwner.id)
  let attached = isOwnerAttached(ownerId)
  let started = false
  const resyncOwnerAttachment = () => {
    attachRetries += 1
    syncOwnersNow(nextDrawTools)
    attached = isOwnerAttached(ownerId)
  }
  const tryRebindIndicatorOwnerToPointerPane = () => {
    if (resolvedTargetPane !== 'indicator' || pointerPaneIndex === null) {
      return false
    }
    let reboundToPane = rebindOrAttachOwnerToPane(ownerId, targetOwner, pointerPaneIndex)
    if (!reboundToPane) {
      // Secondary fallback for owners that already have a stable binding but need pane re-targeting.
      reboundToPane = rebindOwnerToPane(ownerId, pointerPaneIndex)
    }
    if (reboundToPane) {
      attachRetries += 1
      attached = isOwnerAttached(ownerId)
      return true
    }
    return false
  }

  tryRebindIndicatorOwnerToPointerPane()
  if (!attached) {
    resyncOwnerAttachment()
  }
  if (attached) {
    started = startManualTool(toolType, ownerId)
  }
  if (!started && resolvedTargetPane === 'indicator') {
    for (let retry = 0; retry < 2 && !started; retry += 1) {
      resyncOwnerAttachment()
      if (!attached) continue
      started = startManualTool(toolType, ownerId)
    }
    if (!started && tryRebindIndicatorOwnerToPointerPane() && attached) {
      started = startManualTool(toolType, ownerId)
    }
    if (!started) {
      console.warn('[data-chart/draw] indicator start failed', {
        panelId,
        widgetKey,
        toolType,
        pointerPaneIndex,
        mainPaneIndex,
        resolvedIndicatorId,
        ownerId,
        attached,
        attachRetries,
      })
    }
  }
  traceDrawRouting('start-manual-tool', () => ({
    toolType,
    paneIndexOverride: paneIndexOverride ?? null,
    pointerPaneIndex,
    mainPaneIndex,
    resolvedTargetPane,
    resolvedIndicatorId,
    ownerId,
    targetOwner,
    attached,
    attachRetries,
    started,
  }))
  return started
}
