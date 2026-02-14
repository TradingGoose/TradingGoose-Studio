import type { MutableRefObject } from 'react'
import type { IChartApi, IPaneApi, ISeriesApi } from 'lightweight-charts'
import type {
  OwnerId,
  ResolvedOwnerTarget,
} from '@/widgets/widgets/data_chart/drawings/adapter-types'
import { fromManualOwnerId } from '@/widgets/widgets/data_chart/drawings/adapter-utils'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

type AttachmentControllerTargetResolverParams = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  chartScopeKeyRef: MutableRefObject<string>
}

const isSeriesOnChart = (chart: IChartApi, series: ISeriesApi<any>) => {
  try {
    const paneIndex = series.getPane().paneIndex()
    const pane = chart.panes().find((candidatePane) => candidatePane.paneIndex() === paneIndex)
    if (!pane) return false
    return pane.getSeries().includes(series)
  } catch {
    return false
  }
}

const hasSeriesData = (series: ISeriesApi<any>) => {
  try {
    return series.dataByIndex(0, 0 as any) !== null
  } catch {
    return false
  }
}

const hasUsablePriceProjection = (series: ISeriesApi<any>, expectedPaneIndex?: number) => {
  try {
    const pane = series.getPane()
    if (
      typeof expectedPaneIndex === 'number' &&
      Number.isFinite(expectedPaneIndex) &&
      pane.paneIndex() !== expectedPaneIndex
    ) {
      return false
    }
    const paneHeight = pane.getHeight()
    if (!Number.isFinite(paneHeight) || paneHeight <= 1) return false
    const y = Math.min(Math.max(paneHeight / 2, 0), paneHeight - 1)
    const projected = series.coordinateToPrice(y)
    return typeof projected === 'number' && Number.isFinite(projected)
  } catch {
    return false
  }
}

const pickBestSeriesInPane = (
  pane: IPaneApi<any>,
  paneIndex: number,
  mainSeries: ISeriesApi<any> | null,
  preferredSeries?: ISeriesApi<any> | null
) => {
  const paneSeries = pane.getSeries()
  if (paneSeries.length === 0) return null

  const seriesWithProjection = paneSeries.filter((series) =>
    hasUsablePriceProjection(series, paneIndex)
  )
  const scopedSeries = seriesWithProjection.length > 0 ? seriesWithProjection : paneSeries
  const resolvedPreferredSeries =
    preferredSeries &&
    scopedSeries.includes(preferredSeries) &&
    hasUsablePriceProjection(preferredSeries, paneIndex)
      ? preferredSeries
      : null

  let best: ISeriesApi<any> | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  scopedSeries.forEach((series) => {
    let score = 0
    if (series === mainSeries) score -= 100
    if (series === resolvedPreferredSeries) score += 15
    if (hasSeriesData(series)) score += 10
    if (hasUsablePriceProjection(series, paneIndex)) score += 40
    if (score > bestScore) {
      bestScore = score
      best = series
    }
  })

  return best
}

const resolveIndicatorRuntime = (
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>,
  indicatorId: string
) => {
  const normalized = indicatorId.trim()
  if (!normalized) return null

  const direct = indicatorRuntimeRef.current.get(normalized)
  if (direct) {
    return { indicatorId: normalized, runtimeEntry: direct }
  }

  const normalizedLower = normalized.toLowerCase()
  for (const [candidateId, candidateEntry] of indicatorRuntimeRef.current.entries()) {
    if (candidateId.trim().toLowerCase() === normalizedLower) {
      return { indicatorId: candidateId, runtimeEntry: candidateEntry }
    }
  }

  return null
}

export const createAttachmentControllerTargetResolvers = ({
  chartRef,
  mainSeriesRef,
  indicatorRuntimeRef,
  chartScopeKeyRef,
}: AttachmentControllerTargetResolverParams) => {
  const seriesIdentityMap = new WeakMap<ISeriesApi<any>, string>()
  let seriesIdentityCounter = 1

  const getSeriesIdentity = (series: ISeriesApi<any>) => {
    const existing = seriesIdentityMap.get(series)
    if (existing) return existing
    const next = `s${seriesIdentityCounter++}`
    seriesIdentityMap.set(series, next)
    return next
  }

  const resolveRuntimePaneIndex = (
    runtimeEntry: IndicatorRuntimeEntry,
    fallbackPaneIndex: number
  ) => {
    if (!runtimeEntry.pane) {
      return runtimeEntry.paneIndex ?? fallbackPaneIndex
    }
    try {
      return runtimeEntry.pane.paneIndex()
    } catch {
      return runtimeEntry.paneIndex ?? fallbackPaneIndex
    }
  }

  const resolveIndicatorRuntimeForId = (indicatorId: string) =>
    resolveIndicatorRuntime(indicatorRuntimeRef, indicatorId)

  const isSeriesReadyForViewUpdate = (series: ISeriesApi<any>) => {
    const chart = chartRef.current
    if (!chart) return false

    try {
      const visibleRange = chart.timeScale().getVisibleLogicalRange()
      if (
        !visibleRange ||
        !Number.isFinite(visibleRange.from) ||
        !Number.isFinite(visibleRange.to)
      ) {
        return false
      }
    } catch {
      return false
    }

    try {
      return series.dataByIndex(0, 0 as any) !== null
    } catch {
      return false
    }
  }

  const resolveOwnerTarget = (drawToolsRef: DrawToolsRef): ResolvedOwnerTarget | null => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    if (!chart || !mainSeries) return null

    if (drawToolsRef.pane === 'indicator') {
      const requestedIndicatorId =
        typeof drawToolsRef.indicatorId === 'string' ? drawToolsRef.indicatorId.trim() : ''
      if (!requestedIndicatorId) return null
      const runtime = resolveIndicatorRuntimeForId(requestedIndicatorId)
      if (!runtime) return null
      const { indicatorId, runtimeEntry } = runtime
      if (runtimeEntry.errorMessage) return null

      const mainPaneIndex = (() => {
        try {
          return mainSeries.getPane().paneIndex()
        } catch {
          return 0
        }
      })()
      const runtimePaneIndex = resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex)
      if (!Number.isFinite(runtimePaneIndex) || runtimePaneIndex === mainPaneIndex) {
        return null
      }
      const chartPanes = chart.panes()
      const chartPane =
        chartPanes.find((candidatePane) => candidatePane.paneIndex() === runtimePaneIndex) ?? null
      if (!chartPane) return null

      const paneSeries = chartPane.getSeries()
      const isIndicatorPaneSeries = (series: ISeriesApi<any>) =>
        paneSeries.includes(series) && isSeriesOnChart(chart, series) && series !== mainSeries

      const candidateSeries: ISeriesApi<any>[] = []
      const pushCandidateSeries = (series: ISeriesApi<any> | null | undefined) => {
        if (!series) return
        if (!isIndicatorPaneSeries(series)) return
        if (candidateSeries.includes(series)) return
        candidateSeries.push(series)
      }

      pushCandidateSeries(runtimeEntry.paneAnchorSeries ?? null)
      runtimeEntry.plots.forEach((plot) => {
        pushCandidateSeries(plot.series)
      })

      const pickBestCandidateSeries = () => {
        if (candidateSeries.length === 0) return null
        let best: ISeriesApi<any> | null = null
        let bestScore = Number.NEGATIVE_INFINITY

        candidateSeries.forEach((series) => {
          let score = 0
          if (series === runtimeEntry.paneAnchorSeries) score += 20
          if (runtimeEntry.plots.some((plot) => plot.series === series)) score += 10
          if (hasSeriesData(series)) score += 10
          if (hasUsablePriceProjection(series, runtimePaneIndex)) score += 20
          if (score > bestScore) {
            bestScore = score
            best = series
          }
        })
        return best
      }

      let indicatorSeries = pickBestCandidateSeries()
      if (!indicatorSeries) {
        const fallbackPaneSeries = pickBestSeriesInPane(chartPane, runtimePaneIndex, mainSeries)
        if (fallbackPaneSeries && isIndicatorPaneSeries(fallbackPaneSeries)) {
          indicatorSeries = fallbackPaneSeries
        }
      }
      if (!indicatorSeries) return null
      const indicatorSeriesIdentity = getSeriesIdentity(indicatorSeries)
      return {
        pane: 'indicator',
        indicatorId,
        series: indicatorSeries,
        seriesAttachmentKey: `chart:${chartScopeKeyRef.current}:indicator:${indicatorId}:${indicatorSeriesIdentity}`,
      }
    }

    const mainSeriesIdentity = getSeriesIdentity(mainSeries)
    return {
      pane: 'price',
      series: mainSeries,
      seriesAttachmentKey: `chart:${chartScopeKeyRef.current}:price:${mainSeriesIdentity}`,
    }
  }

  const resolvePreferredIndicatorSeriesForPane = (
    indicatorId: string | undefined,
    paneIndex: number
  ) => {
    const normalizedIndicatorId = indicatorId?.trim()
    if (!normalizedIndicatorId) return null

    const anchorSeries =
      resolveIndicatorRuntimeForId(normalizedIndicatorId)?.runtimeEntry.paneAnchorSeries ?? null
    if (!anchorSeries) return null
    if (!hasUsablePriceProjection(anchorSeries, paneIndex)) return null
    return anchorSeries
  }

  const resolveIndicatorTargetForPane = (
    ownerId: OwnerId,
    indicatorId: string | undefined,
    paneIndex: number,
    indicatorKeyFallback?: string
  ): ResolvedOwnerTarget | null => {
    const chart = chartRef.current
    if (!chart) return null

    const pane = chart.panes().find((candidatePane) => candidatePane.paneIndex() === paneIndex)
    if (!pane) return null

    const targetSeries = pickBestSeriesInPane(
      pane,
      paneIndex,
      mainSeriesRef.current,
      resolvePreferredIndicatorSeriesForPane(indicatorId, paneIndex)
    )
    if (!targetSeries) return null

    const normalizedIndicatorId = indicatorId?.trim()
    const runtimeIndicatorId = normalizedIndicatorId
      ? (resolveIndicatorRuntimeForId(normalizedIndicatorId)?.indicatorId ?? normalizedIndicatorId)
      : normalizedIndicatorId
    const indicatorKey =
      runtimeIndicatorId ||
      indicatorKeyFallback ||
      fromManualOwnerId(ownerId) ||
      `pane-${paneIndex}`

    return {
      pane: 'indicator',
      indicatorId: runtimeIndicatorId,
      series: targetSeries,
      seriesAttachmentKey: `chart:${chartScopeKeyRef.current}:indicator:${indicatorKey}:${getSeriesIdentity(targetSeries)}`,
    }
  }

  return {
    isSeriesOnChart,
    isSeriesReadyForViewUpdate,
    hasUsablePriceProjection,
    resolveRuntimePaneIndex,
    resolveIndicatorRuntime: resolveIndicatorRuntimeForId,
    resolveOwnerTarget,
    resolveIndicatorTargetForPane,
  }
}
