'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import {
  createLineToolsPlugin,
  type ILineToolsPlugin,
  type LineToolExport,
} from '@/widgets/widgets/data_chart/plugins/core'
import { LineToolArrow } from '@/widgets/widgets/data_chart/plugins/arrow'
import { LineToolBrush } from '@/widgets/widgets/data_chart/plugins/brush'
import { LineToolCallout } from '@/widgets/widgets/data_chart/plugins/callout'
import { LineToolCircle } from '@/widgets/widgets/data_chart/plugins/circle'
import { LineToolCrossLine } from '@/widgets/widgets/data_chart/plugins/cross-line'
import { LineToolExtendedLine } from '@/widgets/widgets/data_chart/plugins/extended-line'
import { LineToolFibRetracement } from '@/widgets/widgets/data_chart/plugins/fib-retracement'
import { LineToolHighlighter } from '@/widgets/widgets/data_chart/plugins/highlighter'
import { LineToolHorizontalLine } from '@/widgets/widgets/data_chart/plugins/horizontal-line'
import { LineToolHorizontalRay } from '@/widgets/widgets/data_chart/plugins/horizontal-ray'
import { LineToolLongShortPosition } from '@/widgets/widgets/data_chart/plugins/long-short-position'
import { LineToolMarketDepth } from '@/widgets/widgets/data_chart/plugins/market-depth'
import { LineToolParallelChannel } from '@/widgets/widgets/data_chart/plugins/parallel-channel'
import { LineToolPath } from '@/widgets/widgets/data_chart/plugins/path'
import { LineToolPriceRange } from '@/widgets/widgets/data_chart/plugins/price-range'
import { LineToolRay } from '@/widgets/widgets/data_chart/plugins/ray'
import { LineToolRectangle } from '@/widgets/widgets/data_chart/plugins/rectangle'
import { LineToolText } from '@/widgets/widgets/data_chart/plugins/text'
import { LineToolTrendLine } from '@/widgets/widgets/data_chart/plugins/trend-line'
import { LineToolTriangle } from '@/widgets/widgets/data_chart/plugins/triangle'
import { LineToolVerticalLine } from '@/widgets/widgets/data_chart/plugins/vertical-line'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'
import { type ManualToolType, MANUAL_TOOL_TYPES } from '@/widgets/widgets/data_chart/drawings/manual-tool-types'

type OwnerId = string
type SeriesAttachmentKey = string

export type ToolCreateCapability = 'unknown' | 'supported' | 'unsupported'
export type OwnerVisibilityMode = 'hide' | 'show'

type OwnerToolCapability = {
  supportsCreate: ToolCreateCapability
  canEdit: boolean | null
}

type OwnerBinding = {
  seriesAttachmentKey: SeriesAttachmentKey
  pane: 'price' | 'indicator'
  indicatorId?: string
}

type ResolvedOwnerTarget = {
  seriesAttachmentKey: SeriesAttachmentKey
  series: ISeriesApi<any>
  pane: 'price' | 'indicator'
  indicatorId?: string
}

type PluginEntry = {
  plugin: ILineToolsPlugin
  chartElement: HTMLElement
  owners: Set<OwnerId>
  pointerUpHandler: (event: PointerEvent) => void
  windowMouseUpHandler: (event: MouseEvent) => void
  afterEditHandler: (event: unknown) => void
  doubleClickHandler: (event: unknown) => void
}

type DetachOptions = {
  preserveCapabilities?: boolean
  preservePendingSnapshot?: boolean
}

type UseManualLineToolsAdapterParams = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  chartReady: number
  panelId?: string
  drawTools: DrawToolsRef[]
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  indicatorRuntimeVersion: number
  onActiveDrawToolsIdChange?: (drawToolsId: string) => void
}

const MANUAL_DOMAIN_PREFIX = 'manual:'
const INDICATOR_DOMAIN_PREFIX = 'indicator:'

let fallbackChartScopeCounter = 1

const areSetsEqual = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

const parseLineToolExports = (serialized: string): Array<LineToolExport<any>> => {
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed as Array<LineToolExport<any>>
  } catch {
    return []
  }
}

const normalizeSnapshot = (snapshot: unknown): string => {
  if (typeof snapshot !== 'string') return ''
  const trimmed = snapshot.trim()
  if (!trimmed) return ''
  return trimmed
}

const toManualOwnerId = (drawToolsId: string): OwnerId => `${MANUAL_DOMAIN_PREFIX}${drawToolsId}`

const fromManualOwnerId = (ownerId: string): string | null => {
  if (!ownerId.startsWith(MANUAL_DOMAIN_PREFIX)) return null
  return ownerId.slice(MANUAL_DOMAIN_PREFIX.length)
}

const ownerDomainPrefix = (ownerId: string) => {
  if (ownerId.startsWith(MANUAL_DOMAIN_PREFIX)) return MANUAL_DOMAIN_PREFIX
  if (ownerId.startsWith(INDICATOR_DOMAIN_PREFIX)) return INDICATOR_DOMAIN_PREFIX
  return ''
}

const registerAllManualTools = (plugin: ILineToolsPlugin) => {
  plugin.registerLineTool('TrendLine', LineToolTrendLine as any)
  plugin.registerLineTool('Ray', LineToolRay as any)
  plugin.registerLineTool('Arrow', LineToolArrow as any)
  plugin.registerLineTool('ExtendedLine', LineToolExtendedLine as any)
  plugin.registerLineTool('HorizontalLine', LineToolHorizontalLine as any)
  plugin.registerLineTool('HorizontalRay', LineToolHorizontalRay as any)
  plugin.registerLineTool('VerticalLine', LineToolVerticalLine as any)
  plugin.registerLineTool('CrossLine', LineToolCrossLine as any)
  plugin.registerLineTool('Callout', LineToolCallout as any)
  plugin.registerLineTool('Brush', LineToolBrush as any)
  plugin.registerLineTool('Highlighter', LineToolHighlighter as any)
  plugin.registerLineTool('Rectangle', LineToolRectangle as any)
  plugin.registerLineTool('Circle', LineToolCircle as any)
  plugin.registerLineTool('Triangle', LineToolTriangle as any)
  plugin.registerLineTool('Path', LineToolPath as any)
  plugin.registerLineTool('ParallelChannel', LineToolParallelChannel as any)
  plugin.registerLineTool('FibRetracement', LineToolFibRetracement as any)
  plugin.registerLineTool('PriceRange', LineToolPriceRange as any)
  plugin.registerLineTool('LongShortPosition', LineToolLongShortPosition as any)
  plugin.registerLineTool('Text', LineToolText as any)
  plugin.registerLineTool('MarketDepth', LineToolMarketDepth as any)
}

export const useManualLineToolsAdapter = ({
  chartRef,
  mainSeriesRef,
  chartReady,
  panelId,
  drawTools,
  indicatorRuntimeRef,
  indicatorRuntimeVersion,
  onActiveDrawToolsIdChange,
}: UseManualLineToolsAdapterParams) => {
  const [revision, setRevision] = useState(0)
  const fallbackChartScopeKeyRef = useRef<string | null>(null)
  const activeOwnerChangeRef = useRef(onActiveDrawToolsIdChange)
  const currentChartRef = useRef<IChartApi | null>(null)

  const pluginsBySeriesAttachmentKeyRef = useRef<Map<SeriesAttachmentKey, PluginEntry>>(new Map())
  const ownerBindingByIdRef = useRef<Map<OwnerId, OwnerBinding>>(new Map())
  const drawToolsByManualRef = useRef<Map<OwnerId, SeriesAttachmentKey>>(new Map())
  const drawToolsByIndicatorRef = useRef<Map<OwnerId, SeriesAttachmentKey>>(new Map())
  const seriesAttachmentRefCountByKeyRef = useRef<Map<SeriesAttachmentKey, number>>(new Map())
  const ownerToolIdsRef = useRef<Map<OwnerId, Set<string>>>(new Map())
  const ownerToolIdsByTypeRef = useRef<Map<OwnerId, Map<ManualToolType, string>>>(new Map())
  const ownerSelectedIdsRef = useRef<Map<OwnerId, Set<string>>>(new Map())
  const ownerCapabilitiesRef = useRef<Map<OwnerId, Map<ManualToolType, OwnerToolCapability>>>(new Map())
  const pendingOwnerSnapshotRef = useRef<Map<OwnerId, string>>(new Map())
  const seriesIdentityMapRef = useRef<WeakMap<ISeriesApi<any>, string>>(new WeakMap())
  const seriesIdentityCounterRef = useRef(1)

  useEffect(() => {
    activeOwnerChangeRef.current = onActiveDrawToolsIdChange
  }, [onActiveDrawToolsIdChange])

  if (!fallbackChartScopeKeyRef.current) {
    fallbackChartScopeKeyRef.current = `chart-${fallbackChartScopeCounter++}`
  }

  const chartScopeKey = panelId ?? fallbackChartScopeKeyRef.current

  const bumpVersion = () => {
    setRevision((prev) => prev + 1)
  }

  const ensureOwnerToolIds = (ownerId: OwnerId) => {
    const existing = ownerToolIdsRef.current.get(ownerId)
    if (existing) return existing
    const next = new Set<string>()
    ownerToolIdsRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerToolIdsByType = (ownerId: OwnerId) => {
    const existing = ownerToolIdsByTypeRef.current.get(ownerId)
    if (existing) return existing
    const next = new Map<ManualToolType, string>()
    ownerToolIdsByTypeRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerCapabilities = (ownerId: OwnerId) => {
    const existing = ownerCapabilitiesRef.current.get(ownerId)
    if (existing) return existing
    const next = new Map<ManualToolType, OwnerToolCapability>()
    ownerCapabilitiesRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerCapability = (ownerId: OwnerId, type: ManualToolType) => {
    const capabilities = ensureOwnerCapabilities(ownerId)
    const existing = capabilities.get(type)
    if (existing) return existing
    const next: OwnerToolCapability = { supportsCreate: 'unknown', canEdit: null }
    capabilities.set(type, next)
    return next
  }

  const getSeriesIdentity = (series: ISeriesApi<any>) => {
    const existing = seriesIdentityMapRef.current.get(series)
    if (existing) return existing
    const next = `s${seriesIdentityCounterRef.current++}`
    seriesIdentityMapRef.current.set(series, next)
    return next
  }

  const removeIdsFromOwnerState = (ownerId: OwnerId, ids: string[]) => {
    if (ids.length === 0) return
    const ownerIds = ownerToolIdsRef.current.get(ownerId)
    if (ownerIds) {
      ids.forEach((id) => ownerIds.delete(id))
      if (ownerIds.size === 0) {
        ownerToolIdsRef.current.delete(ownerId)
      }
    }

    const idsToRemove = new Set(ids)
    const ownerIdsByType = ownerToolIdsByTypeRef.current.get(ownerId)
    if (ownerIdsByType) {
      for (const [toolType, trackedId] of ownerIdsByType.entries()) {
        if (idsToRemove.has(trackedId)) {
          ownerIdsByType.delete(toolType)
        }
      }
      if (ownerIdsByType.size === 0) {
        ownerToolIdsByTypeRef.current.delete(ownerId)
      }
    }

    const selected = ownerSelectedIdsRef.current.get(ownerId)
    if (selected) {
      ids.forEach((id) => selected.delete(id))
      if (selected.size === 0) {
        ownerSelectedIdsRef.current.delete(ownerId)
      }
    }
  }

  const clearOwnerState = (ownerId: OwnerId, options?: { clearCapabilities?: boolean; clearPending?: boolean }) => {
    ownerToolIdsRef.current.delete(ownerId)
    ownerToolIdsByTypeRef.current.delete(ownerId)
    ownerSelectedIdsRef.current.delete(ownerId)
    if (options?.clearCapabilities !== false) {
      ownerCapabilitiesRef.current.delete(ownerId)
    }
    if (options?.clearPending !== false) {
      pendingOwnerSnapshotRef.current.delete(ownerId)
    }
  }

  const resolveOwnerTarget = (drawToolsRef: DrawToolsRef): ResolvedOwnerTarget | null => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    if (!chart || !mainSeries) return null

    if (drawToolsRef.pane === 'indicator') {
      if (!drawToolsRef.indicatorId) return null
      const runtimeEntry = indicatorRuntimeRef.current.get(drawToolsRef.indicatorId)
      if (!runtimeEntry?.paneAnchorSeries || !runtimeEntry.paneAnchorIdentity) return null
      return {
        pane: 'indicator',
        indicatorId: drawToolsRef.indicatorId,
        series: runtimeEntry.paneAnchorSeries,
        seriesAttachmentKey: `chart:${chartScopeKey}:indicator:${drawToolsRef.indicatorId}:anchor:${runtimeEntry.paneAnchorIdentity}`,
      }
    }

    const mainSeriesIdentity = getSeriesIdentity(mainSeries)
    return {
      pane: 'price',
      series: mainSeries,
      seriesAttachmentKey: `chart:${chartScopeKey}:price:${mainSeriesIdentity}`,
    }
  }

  const getPluginEntryForOwner = (ownerId: OwnerId) => {
    const binding = ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return null
    const pluginEntry = pluginsBySeriesAttachmentKeyRef.current.get(binding.seriesAttachmentKey)
    if (!pluginEntry) return null
    return { binding, pluginEntry }
  }

  const reconcileSelection = (ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) {
      ownerSelectedIdsRef.current.delete(ownerId)
      return
    }

    const selectedExports = parseLineToolExports(pluginContext.pluginEntry.plugin.getSelectedLineTools())
    const ownerIds = ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const nextSelected = new Set<string>()
    selectedExports.forEach((tool) => {
      if (ownerIds.has(tool.id)) {
        nextSelected.add(tool.id)
      }
    })

    const previous = ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    if (!areSetsEqual(previous, nextSelected)) {
      if (nextSelected.size > 0) {
        ownerSelectedIdsRef.current.set(ownerId, nextSelected)
      } else {
        ownerSelectedIdsRef.current.delete(ownerId)
      }
      bumpVersion()
    }

    if (nextSelected.size > 0) {
      const drawToolsId = fromManualOwnerId(ownerId)
      if (drawToolsId) {
        activeOwnerChangeRef.current?.(drawToolsId)
      }
    }
  }

  const exportOwnerSnapshot = (ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return ''

    const ownerIds = ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return ''

    const exported: Array<LineToolExport<any>> = []
    ownerIds.forEach((id) => {
      const singleExport = parseLineToolExports(pluginContext.pluginEntry.plugin.getLineToolByID(id))
      if (singleExport.length > 0) {
        exported.push(singleExport[0])
      }
    })

    if (exported.length === 0) return ''
    return JSON.stringify(exported)
  }

  const importOwnerSnapshot = (ownerId: OwnerId, plugin: ILineToolsPlugin, snapshot: string) => {
    if (!snapshot) return
    const parsed = parseLineToolExports(snapshot)
    if (parsed.length === 0) return
    if (!plugin.importLineTools(JSON.stringify(parsed))) return

    const ownerIds = ensureOwnerToolIds(ownerId)
    const ownerIdsByType = ensureOwnerToolIdsByType(ownerId)
    const ownerCapabilities = ensureOwnerCapabilities(ownerId)

    parsed.forEach((tool) => {
      ownerIds.add(tool.id)

      const toolType = tool.toolType as ManualToolType
      if (!MANUAL_TOOL_TYPES.includes(toolType)) {
        return
      }

      const canEdit = tool.options?.editable !== false
      ownerCapabilities.set(toolType, {
        supportsCreate: 'supported',
        canEdit,
      })
      if (!canEdit) {
        ownerIdsByType.set(toolType, tool.id)
      }
    })
  }

  const reconcileOwnersForSeries = (seriesAttachmentKey: SeriesAttachmentKey) => {
    const pluginEntry = pluginsBySeriesAttachmentKeyRef.current.get(seriesAttachmentKey)
    if (!pluginEntry) return
    pluginEntry.owners.forEach((ownerId) => {
      reconcileSelection(ownerId)
    })
  }

  const destroyPluginEntry = (seriesAttachmentKey: SeriesAttachmentKey, pluginEntry: PluginEntry) => {
    pluginEntry.chartElement.removeEventListener('pointerup', pluginEntry.pointerUpHandler)
    window.removeEventListener('mouseup', pluginEntry.windowMouseUpHandler)
    pluginEntry.plugin.unsubscribeLineToolsAfterEdit(pluginEntry.afterEditHandler as any)
    pluginEntry.plugin.unsubscribeLineToolsDoubleClick(pluginEntry.doubleClickHandler as any)
    pluginEntry.plugin.destroy()
    pluginsBySeriesAttachmentKeyRef.current.delete(seriesAttachmentKey)
    seriesAttachmentRefCountByKeyRef.current.delete(seriesAttachmentKey)
  }

  const createPluginEntry = (target: ResolvedOwnerTarget): PluginEntry | undefined => {
    const chart = chartRef.current
    if (!chart) return undefined

    const plugin = createLineToolsPlugin(chart, target.series)
    registerAllManualTools(plugin)

    const chartElement = chart.chartElement()
    const pointerUpHandler = () => {
      window.requestAnimationFrame(() => {
        reconcileOwnersForSeries(target.seriesAttachmentKey)
      })
    }
    const windowMouseUpHandler = () => {
      window.requestAnimationFrame(() => {
        reconcileOwnersForSeries(target.seriesAttachmentKey)
      })
    }
    const afterEditHandler = () => {
      reconcileOwnersForSeries(target.seriesAttachmentKey)
      bumpVersion()
    }
    const doubleClickHandler = () => {
      reconcileOwnersForSeries(target.seriesAttachmentKey)
    }

    chartElement.addEventListener('pointerup', pointerUpHandler)
    window.addEventListener('mouseup', windowMouseUpHandler)
    plugin.subscribeLineToolsAfterEdit(afterEditHandler as any)
    plugin.subscribeLineToolsDoubleClick(doubleClickHandler as any)

    const pluginEntry: PluginEntry = {
      plugin,
      chartElement,
      owners: new Set<OwnerId>(),
      pointerUpHandler,
      windowMouseUpHandler,
      afterEditHandler,
      doubleClickHandler,
    }

    pluginsBySeriesAttachmentKeyRef.current.set(target.seriesAttachmentKey, pluginEntry)
    return pluginEntry
  }

  const attachOwner = (ownerId: OwnerId, drawToolsRef: DrawToolsRef, target: ResolvedOwnerTarget) => {
    let pluginEntry = pluginsBySeriesAttachmentKeyRef.current.get(target.seriesAttachmentKey)
    if (!pluginEntry) {
      pluginEntry = createPluginEntry(target)
    }
    if (!pluginEntry) return

    const wasAlreadyBound = pluginEntry.owners.has(ownerId)
    if (!wasAlreadyBound) {
      pluginEntry.owners.add(ownerId)
      const currentCount = seriesAttachmentRefCountByKeyRef.current.get(target.seriesAttachmentKey) ?? 0
      seriesAttachmentRefCountByKeyRef.current.set(target.seriesAttachmentKey, currentCount + 1)
    }

    ownerBindingByIdRef.current.set(ownerId, {
      seriesAttachmentKey: target.seriesAttachmentKey,
      pane: drawToolsRef.pane,
      indicatorId: drawToolsRef.indicatorId,
    })

    if (ownerDomainPrefix(ownerId) === MANUAL_DOMAIN_PREFIX) {
      drawToolsByManualRef.current.set(ownerId, target.seriesAttachmentKey)
    } else if (ownerDomainPrefix(ownerId) === INDICATOR_DOMAIN_PREFIX) {
      drawToolsByIndicatorRef.current.set(ownerId, target.seriesAttachmentKey)
    }

    const pendingSnapshot = pendingOwnerSnapshotRef.current.get(ownerId)
    if (pendingSnapshot) {
      importOwnerSnapshot(ownerId, pluginEntry.plugin, pendingSnapshot)
      pendingOwnerSnapshotRef.current.delete(ownerId)
    }

    reconcileSelection(ownerId)
    bumpVersion()
  }

  const detachOwner = (ownerId: OwnerId, options?: DetachOptions) => {
    const binding = ownerBindingByIdRef.current.get(ownerId)
    if (!binding) {
      clearOwnerState(ownerId, {
        clearCapabilities: options?.preserveCapabilities !== true,
        clearPending: options?.preservePendingSnapshot !== true,
      })
      return
    }

    const pluginEntry = pluginsBySeriesAttachmentKeyRef.current.get(binding.seriesAttachmentKey)
    if (pluginEntry) {
      const ownerIds = ownerToolIdsRef.current.get(ownerId)
      if (ownerIds && ownerIds.size > 0) {
        const ids = Array.from(ownerIds)
        pluginEntry.plugin.removeLineToolsById(ids)
        removeIdsFromOwnerState(ownerId, ids)
      }

      pluginEntry.owners.delete(ownerId)

      const currentCount = seriesAttachmentRefCountByKeyRef.current.get(binding.seriesAttachmentKey) ?? 0
      const nextCount = Math.max(0, currentCount - 1)
      if (nextCount === 0) {
        destroyPluginEntry(binding.seriesAttachmentKey, pluginEntry)
      } else {
        seriesAttachmentRefCountByKeyRef.current.set(binding.seriesAttachmentKey, nextCount)
      }
    }

    ownerBindingByIdRef.current.delete(ownerId)
    drawToolsByManualRef.current.delete(ownerId)
    drawToolsByIndicatorRef.current.delete(ownerId)
    clearOwnerState(ownerId, {
      clearCapabilities: options?.preserveCapabilities !== true,
      clearPending: options?.preservePendingSnapshot !== true,
    })
    bumpVersion()
  }

  const reconcileOwnerAttachment = (drawToolsRef: DrawToolsRef) => {
    const ownerId = toManualOwnerId(drawToolsRef.id)
    const currentBinding = ownerBindingByIdRef.current.get(ownerId)
    const target = resolveOwnerTarget(drawToolsRef)
    const persistedSnapshot = normalizeSnapshot(drawToolsRef.snapshot)

    if (!target) {
      if (!currentBinding && persistedSnapshot && !pendingOwnerSnapshotRef.current.has(ownerId)) {
        pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      if (currentBinding) {
        const ownerSnapshot = exportOwnerSnapshot(ownerId)
        if (ownerSnapshot) {
          pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
        }
        detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      }
      return
    }

    if (!currentBinding) {
      if (
        persistedSnapshot &&
        !pendingOwnerSnapshotRef.current.has(ownerId) &&
        (ownerToolIdsRef.current.get(ownerId)?.size ?? 0) === 0
      ) {
        pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      attachOwner(ownerId, drawToolsRef, target)
      return
    }

    if (currentBinding.seriesAttachmentKey !== target.seriesAttachmentKey) {
      const ownerSnapshot = exportOwnerSnapshot(ownerId)
      if (ownerSnapshot) {
        pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
      }
      detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      attachOwner(ownerId, drawToolsRef, target)
      reconcileSelection(ownerId)
      return
    }

    reconcileSelection(ownerId)
  }

  const teardownAll = useCallback(() => {
    ownerBindingByIdRef.current.forEach((_, ownerId) => {
      detachOwner(ownerId)
    })

    pluginsBySeriesAttachmentKeyRef.current.forEach((pluginEntry, seriesAttachmentKey) => {
      destroyPluginEntry(seriesAttachmentKey, pluginEntry)
    })

    ownerBindingByIdRef.current.clear()
    drawToolsByManualRef.current.clear()
    drawToolsByIndicatorRef.current.clear()
    seriesAttachmentRefCountByKeyRef.current.clear()
    ownerToolIdsRef.current.clear()
    ownerToolIdsByTypeRef.current.clear()
    ownerSelectedIdsRef.current.clear()
    ownerCapabilitiesRef.current.clear()
    pendingOwnerSnapshotRef.current.clear()
    bumpVersion()
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (currentChartRef.current && currentChartRef.current !== chart) {
      teardownAll()
    }
    currentChartRef.current = chart
  }, [chartReady, chartRef, teardownAll])

  useEffect(() => {
    return () => {
      teardownAll()
    }
  }, [teardownAll])

  useEffect(() => {
    const nextOwnerIds = new Set(drawTools.map((entry) => toManualOwnerId(entry.id)))

    ownerBindingByIdRef.current.forEach((_, ownerId) => {
      if (!nextOwnerIds.has(ownerId)) {
        detachOwner(ownerId)
      }
    })

    drawTools.forEach((entry) => {
      reconcileOwnerAttachment(entry)
    })
  }, [chartReady, drawTools, indicatorRuntimeVersion, chartRef, mainSeriesRef])

  const startManualTool = useCallback((type: ManualToolType, ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return false

    const capability = ensureOwnerCapability(ownerId, type)
    if (capability.supportsCreate === 'unsupported') {
      return false
    }

    if (capability.canEdit === false) {
      const byType = ensureOwnerToolIdsByType(ownerId)
      const trackedId = byType.get(type)
      if (trackedId) {
        pluginContext.pluginEntry.plugin.removeLineToolsById([trackedId])
        removeIdsFromOwnerState(ownerId, [trackedId])
      }
    }

    const createdId = pluginContext.pluginEntry.plugin.addLineTool(type, [])
    if (!createdId) {
      capability.supportsCreate = 'unsupported'
      bumpVersion()
      return false
    }

    capability.supportsCreate = 'supported'

    const ownerIds = ensureOwnerToolIds(ownerId)
    ownerIds.add(createdId)

    const createdExport = parseLineToolExports(pluginContext.pluginEntry.plugin.getLineToolByID(createdId))[0]
    const canEdit = createdExport?.options?.editable !== false
    capability.canEdit = canEdit

    const byType = ensureOwnerToolIdsByType(ownerId)
    if (canEdit) {
      byType.delete(type)
    } else {
      byType.set(type, createdId)
    }

    reconcileSelection(ownerId)
    bumpVersion()
    return true
  }, [])

  const toggleManualTool = useCallback((type: ManualToolType, ownerId: OwnerId) => {
    const capability = ensureOwnerCapability(ownerId, type)
    if (capability.canEdit === false) {
      const pluginContext = getPluginEntryForOwner(ownerId)
      const trackedId = ownerToolIdsByTypeRef.current.get(ownerId)?.get(type)
      if (pluginContext && trackedId) {
        pluginContext.pluginEntry.plugin.removeLineToolsById([trackedId])
        removeIdsFromOwnerState(ownerId, [trackedId])
        reconcileSelection(ownerId)
        bumpVersion()
        return true
      }
    }
    return startManualTool(type, ownerId)
  }, [startManualTool])

  const removeSelected = useCallback((ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const selectedIds = ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    const removable = Array.from(selectedIds).filter((id) => ownerIds.has(id))
    if (removable.length === 0) return

    pluginContext.pluginEntry.plugin.removeLineToolsById(removable)
    removeIdsFromOwnerState(ownerId, removable)
    reconcileSelection(ownerId)
    bumpVersion()
  }, [])

  const hideSelected = useCallback((ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const selectedIds = ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    const hidAny = Array.from(selectedIds).reduce((updated, id) => {
      if (!ownerIds.has(id)) return updated
      const toolExport = parseLineToolExports(pluginContext.pluginEntry.plugin.getLineToolByID(id))[0]
      if (!toolExport) return updated
      pluginContext.pluginEntry.plugin.applyLineToolOptions({
        ...toolExport,
        options: {
          ...toolExport.options,
          visible: false,
        },
      })
      return true
    }, false)

    if (!hidAny) return

    reconcileSelection(ownerId)
    bumpVersion()
  }, [])

  const clearAll = useCallback((ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return
    const ids = Array.from(ownerIds)
    pluginContext.pluginEntry.plugin.removeLineToolsById(ids)
    removeIdsFromOwnerState(ownerId, ids)
    reconcileSelection(ownerId)
    bumpVersion()
  }, [])

  const hasOwnerTools = useCallback((ownerId: OwnerId) => {
    return (ownerToolIdsRef.current.get(ownerId)?.size ?? 0) > 0
  }, [])

  const getOwnerSnapshot = useCallback((ownerId: OwnerId) => {
    const exported = exportOwnerSnapshot(ownerId)
    if (exported) return exported
    return pendingOwnerSnapshotRef.current.get(ownerId) ?? ''
  }, [])

  const getOwnerVisibilityMode = useCallback((ownerId: OwnerId): OwnerVisibilityMode => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return 'hide'

    const ownerIds = ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return 'hide'

    let hasHidden = false
    for (const id of ownerIds) {
      const toolExport = parseLineToolExports(pluginContext.pluginEntry.plugin.getLineToolByID(id))[0]
      if (!toolExport) continue
      if (toolExport.options?.visible === false) {
        hasHidden = true
        break
      }
    }

    return hasHidden ? 'show' : 'hide'
  }, [])

  const setAllVisibility = useCallback((ownerId: OwnerId, visible: boolean) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return

    let updated = false
    ownerIds.forEach((id) => {
      const toolExport = parseLineToolExports(pluginContext.pluginEntry.plugin.getLineToolByID(id))[0]
      if (!toolExport) return
      const currentlyVisible = toolExport.options?.visible !== false
      if (currentlyVisible === visible) return

      pluginContext.pluginEntry.plugin.applyLineToolOptions({
        ...toolExport,
        options: {
          ...toolExport.options,
          visible,
        },
      })
      updated = true
    })

    if (!updated) return

    reconcileSelection(ownerId)
    bumpVersion()
  }, [])

  const getToolCapability = useCallback((ownerId: OwnerId, type: ManualToolType): ToolCreateCapability => {
    return ownerCapabilitiesRef.current.get(ownerId)?.get(type)?.supportsCreate ?? 'unknown'
  }, [])

  const isNonSelectableToolActive = useCallback((ownerId: OwnerId, type: ManualToolType) => {
    const capability = ownerCapabilitiesRef.current.get(ownerId)?.get(type)
    if (!capability || capability.canEdit !== false) return false
    return ownerToolIdsByTypeRef.current.get(ownerId)?.has(type) ?? false
  }, [])

  const hasSelectedManualDrawingsInPane = useCallback((ownerId: OwnerId, paneIndex: number) => {
    const selected = ownerSelectedIdsRef.current.get(ownerId)
    if (!selected || selected.size === 0) return false

    const binding = ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return false

    if (binding.pane === 'price') {
      const mainSeries = mainSeriesRef.current
      if (!mainSeries) return false
      return mainSeries.getPane().paneIndex() === paneIndex
    }

    if (!binding.indicatorId) return false
    const runtimeEntry = indicatorRuntimeRef.current.get(binding.indicatorId)
    if (!runtimeEntry?.pane) return false
    return runtimeEntry.pane.paneIndex() === paneIndex
  }, [indicatorRuntimeVersion, indicatorRuntimeRef, mainSeriesRef])

  const getSelectedCount = useCallback((ownerId: OwnerId) => {
    return ownerSelectedIdsRef.current.get(ownerId)?.size ?? 0
  }, [])

  return {
    revision,
    teardownAll,
    toManualOwnerId,
    startManualTool,
    toggleManualTool,
    removeSelected,
    hideSelected,
    clearAll,
    hasOwnerTools,
    getOwnerSnapshot,
    getOwnerVisibilityMode,
    setAllVisibility,
    getToolCapability,
    isNonSelectableToolActive,
    hasSelectedManualDrawingsInPane,
    getSelectedCount,
    reconcileSelection,
  }
}
