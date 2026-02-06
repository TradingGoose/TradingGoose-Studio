'use client'

import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { Socket } from 'socket.io-client'
import { type ListingIdentity, resolveListingKey } from '@/lib/listing/identity'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type {
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
  MarketSessionWindow,
} from '@/providers/market/types'
import { useChartRescale } from '@/widgets/widgets/new_data_chart/hooks/use-chart-rescale'
import { useLiveBars } from '@/widgets/widgets/new_data_chart/hooks/use-live-bars'
import {
  buildIndexMaps,
  DEFAULT_BAR_COUNT,
  intervalToMs,
  mapBarsMsToSeriesData,
  mapMarketSeriesToBarsMs,
  mergeBarsMs,
  findFirstInvalidSeriesDatum,
  sanitizeSeriesData,
  sanitizeBarsMs,
} from '@/widgets/widgets/new_data_chart/series-data'
import { DEFAULT_RIGHT_OFFSET } from '@/widgets/widgets/new_data_chart/utils/chart-styles'
import {
  coerceProviderParams,
  sanitizeNormalizationMode,
} from '@/widgets/widgets/new_data_chart/series-window'
import type {
  NewDataChartDataContext,
  NewDataChartWidgetParams,
} from '@/widgets/widgets/new_data_chart/types'
import { resolveProviderErrorMessage } from '@/widgets/widgets/new_data_chart/utils/chart-errors'
import {
  assertMarketSeries,
  resolveExpectedBars,
  resolveForwardSpanMs,
  resolveSeriesSpanMs,
} from '@/widgets/widgets/new_data_chart/utils/series-loader'

type SeriesWindow = ReturnType<
  typeof import('@/widgets/widgets/new_data_chart/series-window').resolveSeriesWindow
>

const DAY_MS = 24 * 60 * 60 * 1000
const PREFETCH_THRESHOLD = 126
const EMPTY_BARS_ERROR = 'No bar data returned'

const mergeMarketSessions = (
  current: MarketSessionWindow[],
  incoming?: MarketSessionWindow[] | null
) => {
  if (!incoming || incoming.length === 0) return current
  if (!current || current.length === 0) {
    return [...incoming].sort((a, b) => a.start.localeCompare(b.start))
  }
  const byKey = new Map<string, MarketSessionWindow>()
  for (const session of current) {
    byKey.set(`${session.start}|${session.type}`, session)
  }
  for (const session of incoming) {
    byKey.set(`${session.start}|${session.type}`, session)
  }
  return Array.from(byKey.values()).sort((a, b) => a.start.localeCompare(b.start))
}

type UseChartDataLoaderArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  mainSeriesRef: MutableRefObject<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'> | null
  >
  socket?: Socket | null
  workspaceId?: string | null
  providerId?: string | null
  listing: ListingIdentity | null
  seriesWindow: SeriesWindow
  dataParams: NewDataChartWidgetParams
  dataContext: NewDataChartDataContext
  onDataLoaded?: () => void
  onDataUpdated?: () => void
  onDataBackfill?: () => void
}

const resolveRetentionRule = (providerId: string | null | undefined, interval?: string | null) => {
  if (!providerId) return undefined
  const capabilities = getMarketSeriesCapabilities(providerId)
  const retention = capabilities?.retention
  if (!retention) return undefined
  const intervalKey = interval as MarketInterval | undefined
  if (intervalKey && retention.byInterval?.[intervalKey]) {
    return retention.byInterval[intervalKey]
  }
  return retention.default
}

export const useChartDataLoader = ({
  chartRef,
  chartContainerRef,
  mainSeriesRef,
  socket,
  workspaceId,
  providerId,
  listing,
  seriesWindow,
  dataParams,
  dataContext,
  onDataLoaded,
  onDataUpdated,
  onDataBackfill,
}: UseChartDataLoaderArgs) => {
  const [chartError, setChartError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [seriesTimezone, setSeriesTimezone] = useState<string | null>(null)
  const lastProviderRef = useRef<string | null>(null)
  const lastListingKeyRef = useRef<string | null>(null)
  const lastWindowSpanRef = useRef<number | null>(null)
  const expectedBarsRef = useRef<number | null>(null)
  const lastRefreshAtRef = useRef<number | null>(null)
  const loaderVersionRef = useRef(0)
  const rescaleKeyRef = useRef<string | null>(null)
  const isLoadingOlderDataRef = useRef(false)
  const hasMoreHistoricalDataRef = useRef(true)
  const historicalCursorRef = useRef<number | null>(null)
  const pendingRangeRef = useRef<{ startMs: number; endMs: number } | null>(null)
  const { resetRescale, scheduleRescale, cancelRescale } = useChartRescale({
    chartRef,
    chartContainerRef,
  })

  const requestInterval = seriesWindow.requestInterval
  const retentionRule = useMemo(
    () => resolveRetentionRule(providerId, requestInterval ?? seriesWindow.interval ?? null),
    [providerId, requestInterval, seriesWindow.interval]
  )
  const listingKey = useMemo(() => (listing ? resolveListingKey(listing) : null), [listing])
  const rangeKey = seriesWindow.windowKey ?? 'none'
  const rescaleKey = useMemo(
    () => `${listingKey ?? 'none'}|${seriesWindow.interval ?? ''}|${rangeKey}`,
    [listingKey, rangeKey, seriesWindow.interval]
  )
  const providerParams = useMemo(() => {
    if (!providerId) return undefined
    const rawParams = { ...(dataParams.data?.providerParams ?? {}) } as Record<string, unknown>
    rawParams.apiKey = undefined
    rawParams.apiSecret = undefined
    const marketSession = dataParams.view?.marketSession
    if (marketSession) {
      rawParams.marketSession = marketSession
    }
    return coerceProviderParams(providerId, rawParams)
  }, [dataParams.data?.providerParams, dataParams.view?.marketSession, providerId])
  const authParams = dataParams.data?.auth
  const normalizationMode = useMemo(() => {
    if (!providerId) return undefined
    const rawMode = providerParams?.normalization_mode
    const trimmedMode = typeof rawMode === 'string' ? rawMode.trim() : ''
    const capabilities = getMarketSeriesCapabilities(providerId)
    const fallbackMode = capabilities?.normalizationModes?.[0] ?? 'raw'
    const resolvedMode = trimmedMode || fallbackMode
    return sanitizeNormalizationMode(providerId, resolvedMode)
  }, [providerId, providerParams])

  const liveEnabled = dataParams.data?.live?.enabled !== false
  const liveInterval = dataParams.data?.live?.interval ?? seriesWindow.interval ?? requestInterval
  const { startLiveSubscription, stopLiveSubscription } = useLiveBars({
    socket,
    workspaceId,
    providerId,
    listing,
    interval: liveInterval,
    providerParams,
    auth: authParams,
    enabled: liveEnabled,
    candleType: dataParams.view?.candleType,
    mainSeriesRef,
    dataContext,
    onError: setChartError,
    onDataUpdated,
  })

  const resetHistoryState = () => {
    hasMoreHistoricalDataRef.current = true
    isLoadingOlderDataRef.current = false
    historicalCursorRef.current = null
  }

  const isEmptyBarsError = (error: unknown) =>
    error instanceof Error && error.message.toLowerCase().includes(EMPTY_BARS_ERROR.toLowerCase())

  const retryIfEmptyBars = async <T,>(
    fetcher: () => Promise<T>,
    retryFetcher?: () => Promise<T>
  ): Promise<T> => {
    try {
      return await fetcher()
    } catch (error) {
      if (!isEmptyBarsError(error)) {
        throw error
      }
      if (!retryFetcher) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
      return await retryFetcher()
    }
  }

  const clampPendingRange = (
    startMs: number,
    endMs: number,
    intervalMs?: number | null
  ): { startMs: number; endMs: number } | null => {
    const nowMs = Date.now()
    const futureBuffer = intervalMs ? intervalMs * DEFAULT_RIGHT_OFFSET : 0
    const maxEndMs = nowMs + futureBuffer
    if (startMs >= maxEndMs) return null
    if (endMs <= maxEndMs) return { startMs, endMs }
    const span = endMs - startMs
    const nextEnd = maxEndMs
    const nextStart = Math.max(0, nextEnd - span)
    return nextStart < nextEnd ? { startMs: nextStart, endMs: nextEnd } : null
  }

  useEffect(() => {
    const chart = chartRef.current
    const nextProvider = providerId ?? null
    const nextListingKey = listingKey ?? null
    const providerChanged = lastProviderRef.current !== nextProvider
    const listingChanged = lastListingKeyRef.current !== nextListingKey

    if (providerChanged || listingChanged) {
      const start = dataParams.view?.start
      const end = dataParams.view?.end
      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start < end
      ) {
        const intervalMs = intervalToMs(seriesWindow.interval ?? requestInterval ?? null)
        pendingRangeRef.current = clampPendingRange(start, end, intervalMs)
      } else {
        pendingRangeRef.current = null
      }
    }

    if (!chart) {
      lastProviderRef.current = nextProvider
      lastListingKeyRef.current = nextListingKey
      return
    }

    if (providerChanged && lastProviderRef.current) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      resetHistoryState()
    }

    if (listingChanged && lastListingKeyRef.current) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      resetHistoryState()
    }

    lastProviderRef.current = nextProvider
    lastListingKeyRef.current = nextListingKey
  }, [chartRef, listingKey, providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!providerId || !listing) {
      setIsLoading(false)
      return
    }

    const refreshAt =
      typeof dataParams.runtime?.refreshAt === 'number' ? dataParams.runtime.refreshAt : null
    const refreshChanged =
      refreshAt !== null &&
      (lastRefreshAtRef.current === null || lastRefreshAtRef.current !== refreshAt)
    if (refreshChanged) {
      lastRefreshAtRef.current = refreshAt
      resetRescale()
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      resetHistoryState()
    }

    const windowChanged = rescaleKeyRef.current !== rescaleKey
    if (windowChanged) {
      rescaleKeyRef.current = rescaleKey
      resetRescale()
      lastWindowSpanRef.current = null
      const primaryWindow = seriesWindow.windows?.[0]
      expectedBarsRef.current =
        primaryWindow?.mode === 'bars'
          ? resolveExpectedBars(primaryWindow, seriesWindow.interval ?? requestInterval)
          : null
      resetHistoryState()
    }

    loaderVersionRef.current += 1
    const loaderVersion = loaderVersionRef.current

    const resolveRetentionStartMs = () => {
      if (!retentionRule?.maxRangeDays || retentionRule.maxRangeDays <= 0) return null
      return Date.now() - retentionRule.maxRangeDays * DAY_MS
    }

    const updateMarketSessions = (incoming?: MarketSessionWindow[] | null) => {
      if (!incoming || incoming.length === 0) return
      dataContext.marketSessionsRef.current = mergeMarketSessions(
        dataContext.marketSessionsRef.current,
        incoming
      )
    }

    const fetchSeriesRequest = async (request: MarketSeriesRequest): Promise<MarketSeries> => {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          providerNamespace: 'market',
          workspaceId: workspaceId ?? undefined,
          auth: authParams,
          ...request,
        }),
      })

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        throw new Error(resolveProviderErrorMessage(payload, 'Failed to load series data'))
      }

      return assertMarketSeries(payload)
    }

    const fetchSeries = async (allowEmpty = false): Promise<MarketSeries> => {
      const windows = seriesWindow.windows ?? []
      if (!windows.length) {
        throw new Error('Invalid time window')
      }
      return fetchSeriesRequest({
        kind: 'series',
        listing,
        interval: requestInterval,
        normalizationMode,
        providerParams: allowEmpty ? { ...(providerParams ?? {}), allowEmpty: true } : providerParams,
        windows,
      })
    }

    const fetchSeriesRange = async (
      startMs: number,
      endMs: number,
      allowEmpty = false
    ): Promise<MarketSeries> => {
      const request: MarketSeriesRequest = {
        kind: 'series',
        listing,
        interval: requestInterval,
        normalizationMode,
        providerParams: allowEmpty
          ? { ...(providerParams ?? {}), allowEmpty: true }
          : providerParams,
        windows: [{ mode: 'absolute', start: startMs, end: endMs }],
      }
      return fetchSeriesRequest(request)
    }

    const resolveIntervalMs = () =>
      dataContext.intervalMs ?? intervalToMs(seriesWindow.interval ?? requestInterval ?? null)

    const ensureMinimumBars = async (
      seedBars: ReturnType<typeof mapMarketSeriesToBarsMs>
    ): Promise<ReturnType<typeof mapMarketSeriesToBarsMs>> => {
      const targetBars = expectedBarsRef.current
      if (!targetBars || targetBars <= 0) return seedBars
      if (seedBars.length >= targetBars) return seedBars
      const intervalMs = resolveIntervalMs()
      if (!intervalMs) return seedBars

      const retentionStartMs = resolveRetentionStartMs()
      let merged = seedBars
      let boundary = merged[0]?.openTime ?? null
      let attempts = 0

      while (boundary && merged.length < targetBars && attempts < 4) {
        attempts += 1
        const remaining = targetBars - merged.length
        const spanBars = Math.max(remaining, DEFAULT_BAR_COUNT)
        let startMs = Math.max(0, boundary - intervalMs * spanBars)
        if (retentionStartMs !== null && startMs < retentionStartMs) {
          startMs = retentionStartMs
        }
        if (startMs >= boundary) break

        let incomingBars: ReturnType<typeof mapMarketSeriesToBarsMs> = []
        try {
          const seriesResponse = await fetchSeriesRange(startMs, boundary)
          if (loaderVersion !== loaderVersionRef.current) return merged
          updateMarketSessions(seriesResponse.marketSessions)
          incomingBars = mapMarketSeriesToBarsMs(seriesResponse, dataContext.intervalMs)
        } catch (error) {
          console.warn('Failed to load additional chart history', error)
          break
        }

        if (incomingBars.length === 0) {
          boundary = startMs
          if (retentionStartMs !== null && boundary <= retentionStartMs) break
          continue
        }

        const next = mergeBarsMs(merged, incomingBars, dataContext.intervalMs)
        if (next.length === merged.length) {
          boundary = startMs
          continue
        }
        merged = next
        boundary = merged[0]?.openTime ?? null
      }

      return merged
    }

    const primaryWindow = seriesWindow.windows?.[0]

    const loadSeries = async () => {
      setIsLoading(true)
      try {
        const pendingRange = pendingRangeRef.current
        const useExplicitRange = Boolean(pendingRange)
        if (pendingRange) {
          pendingRangeRef.current = null
          expectedBarsRef.current = null
        }
        dataContext.marketSessionsRef.current = []
        const seriesResponse = await retryIfEmptyBars(
          () =>
            useExplicitRange && pendingRange
              ? fetchSeriesRange(pendingRange.startMs, pendingRange.endMs)
              : fetchSeries(),
          () =>
            useExplicitRange && pendingRange
              ? fetchSeriesRange(pendingRange.startMs, pendingRange.endMs, true)
              : fetchSeries(true)
        )
        if (loaderVersion !== loaderVersionRef.current) return
        updateMarketSessions(seriesResponse.marketSessions)
        let barsMs = mapMarketSeriesToBarsMs(seriesResponse, dataContext.intervalMs)
        if (!useExplicitRange && primaryWindow?.mode !== 'range') {
          barsMs = await ensureMinimumBars(barsMs)
          if (loaderVersion !== loaderVersionRef.current) return
        }
        barsMs = sanitizeBarsMs(barsMs)
        dataContext.barsMsRef.current = barsMs
        const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(barsMs)
        dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
        dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex

        const chartSeries = mainSeriesRef.current
        if (chartSeries) {
          const seriesType = chartSeries.seriesType()
          const isLineSeries = seriesType === 'Area'
          const seriesData = mapBarsMsToSeriesData(barsMs, isLineSeries ? 'area' : null)
          applySeriesData(chartSeries, seriesData, isLineSeries ? 'area' : null, 'loadSeries')
        }

        const retentionStartMs = resolveRetentionStartMs()
        const earliestTimestamp = barsMs[0]?.openTime ?? null
        const canLoadMore =
          retentionStartMs === null
            ? true
            : typeof earliestTimestamp === 'number' && earliestTimestamp > retentionStartMs
        hasMoreHistoricalDataRef.current = canLoadMore

        onDataLoaded?.()
        const expectedBars =
          primaryWindow?.mode === 'range' && typeof expectedBarsRef.current === 'number'
            ? Math.min(expectedBarsRef.current, barsMs.length)
            : expectedBarsRef.current
        scheduleRescale(expectedBars, barsMs.length)
        const resolvedSpan = resolveSeriesSpanMs({
          series: seriesResponse,
          interval: seriesWindow.interval ?? requestInterval,
        })
        const intervalMs = resolveIntervalMs()
        const computedSpan =
          barsMs.length > 1 && intervalMs
            ? barsMs[barsMs.length - 1].openTime - barsMs[0].openTime + intervalMs
            : null
        if (typeof computedSpan === 'number' && Number.isFinite(computedSpan)) {
          lastWindowSpanRef.current = Math.max(resolvedSpan ?? 0, computedSpan)
        } else {
          lastWindowSpanRef.current = resolvedSpan
        }
        const timezone =
          typeof seriesResponse.timezone === 'string' ? seriesResponse.timezone.trim() : ''
        const nextTimezone = timezone || null
        setSeriesTimezone((prev) => (prev === nextTimezone ? prev : nextTimezone))
        setChartError(null)
      } catch (error) {
        console.error('Failed to load chart data', error)
        setChartError(error instanceof Error ? error.message : 'Failed to load data')
      } finally {
        setIsLoading(false)
      }
    }

    loadSeries()

    const timeScale = chart.timeScale()

    const clampLogicalRange = (fromIndex: number, toIndex: number, totalBars: number) => {
      const maxIndex = Math.max(0, totalBars - 1)
      let from = Math.max(0, Math.min(fromIndex, maxIndex))
      let to = Math.max(0, Math.min(toIndex, maxIndex))
      if (from > to) {
        const pivot = Math.min(from, to)
        from = pivot
        to = pivot
      }
      return { from, to }
    }

    const resolveAnchorFromRange = (
      range: { from: number; to: number } | null,
      openTimes: number[]
    ): { fromTime: number; toTime: number } | null => {
      if (!range || openTimes.length === 0) return null
      const fromIndex = Math.max(0, Math.floor(range.from))
      const toIndex = Math.min(openTimes.length - 1, Math.ceil(range.to))
      const fromTime = openTimes[fromIndex]
      const toTime = openTimes[toIndex]
      if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null
      return { fromTime, toTime }
    }

    const resolveAnchoredRange = (
      anchor: { fromTime: number; toTime: number } | null,
      indexByOpenTimeMs: Map<number, number>,
      totalBars: number
    ): { from: number; to: number } | null => {
      if (!anchor || totalBars <= 0) return null
      const fromIndex = indexByOpenTimeMs.get(anchor.fromTime)
      const toIndex = indexByOpenTimeMs.get(anchor.toTime)
      if (fromIndex === undefined || toIndex === undefined) return null
      return clampLogicalRange(fromIndex, toIndex, totalBars)
    }

    const handleVisibleRangeChange = async (range: { from: number; to: number } | null) => {
      if (!range) return
      if (loaderVersion !== loaderVersionRef.current) return
      if (primaryWindow?.mode === 'range' && range.from >= 0) return
      if (isLoadingOlderDataRef.current || !hasMoreHistoricalDataRef.current) return

      const needsMore = (visibleRange: { from: number; to: number }) =>
        visibleRange.from <= PREFETCH_THRESHOLD

      if (!needsMore(range)) return

      isLoadingOlderDataRef.current = true
      let attempts = 0
      let activeRange: { from: number; to: number } | null = range

      try {
        while (
          activeRange &&
          needsMore(activeRange) &&
          hasMoreHistoricalDataRef.current &&
          attempts < 4
        ) {
          attempts += 1
          if (loaderVersion !== loaderVersionRef.current) return

          const currentBars = dataContext.barsMsRef.current
          if (currentBars.length === 0) return

          const oldestBar = currentBars[0]
          if (!oldestBar) return

          const spanMs = resolveForwardSpanMs({
            window: seriesWindow.windows?.[0],
            interval: seriesWindow.interval ?? requestInterval,
            lastWindowSpanMs: lastWindowSpanRef.current,
          })
          if (!spanMs) return

          const boundary = historicalCursorRef.current
            ? Math.min(oldestBar.openTime, historicalCursorRef.current)
            : oldestBar.openTime
          if (!boundary) return

          const retentionStartMs = resolveRetentionStartMs()
          let startMs = Math.max(0, boundary - spanMs)
          if (retentionStartMs !== null && startMs < retentionStartMs) {
            startMs = retentionStartMs
          }
          if (startMs >= boundary) {
            hasMoreHistoricalDataRef.current = false
            return
          }

          try {
            const seriesResponse = await fetchSeriesRange(startMs, boundary, true)
            if (loaderVersion !== loaderVersionRef.current) return
            updateMarketSessions(seriesResponse.marketSessions)
            const incomingBars = mapMarketSeriesToBarsMs(seriesResponse, dataContext.intervalMs)
            if (incomingBars.length === 0) {
              historicalCursorRef.current = startMs
              const canLoadMore = retentionStartMs === null ? true : startMs > retentionStartMs
              hasMoreHistoricalDataRef.current = canLoadMore
              activeRange = timeScale.getVisibleLogicalRange()
              continue
            }

            const previousRange = timeScale.getVisibleLogicalRange()
            const anchorRange = resolveAnchorFromRange(
              previousRange,
              dataContext.openTimeMsByIndexRef.current
            )
            let merged = sanitizeBarsMs(
              mergeBarsMs(currentBars, incomingBars, dataContext.intervalMs)
            )
            if (
              retentionRule?.maxBars &&
              retentionRule.maxBars > 0 &&
              merged.length > retentionRule.maxBars
            ) {
              merged = merged.slice(merged.length - retentionRule.maxBars)
            }
            const addedBars = merged.length - currentBars.length
            historicalCursorRef.current = null
            dataContext.barsMsRef.current = merged
            const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(merged)
            dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
            dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex

            if (mainSeriesRef.current) {
              const series = mainSeriesRef.current
              const seriesType = series.seriesType()
              const isLineSeries = seriesType === 'Area'
              const seriesData = mapBarsMsToSeriesData(merged, isLineSeries ? 'area' : null)
              applySeriesData(series, seriesData, isLineSeries ? 'area' : null, 'backfill')
            }

            if (addedBars <= 0) {
              historicalCursorRef.current = startMs
              const canLoadMore = retentionStartMs === null ? true : startMs > retentionStartMs
              hasMoreHistoricalDataRef.current = canLoadMore
              activeRange = timeScale.getVisibleLogicalRange()
              continue
            }

            const anchoredRange = resolveAnchoredRange(anchorRange, indexByOpenTimeMs, merged.length)
            if (anchoredRange) {
              timeScale.setVisibleLogicalRange(anchoredRange)
              activeRange = anchoredRange
            } else {
              activeRange = timeScale.getVisibleLogicalRange()
            }

            const earliestTimestamp = merged[0]?.openTime ?? null
            const canLoadMore =
              retentionStartMs === null
                ? incomingBars.length > 0
                : typeof earliestTimestamp === 'number' && earliestTimestamp > retentionStartMs
            hasMoreHistoricalDataRef.current = canLoadMore

            onDataBackfill?.()
            if (!activeRange) {
              activeRange = timeScale.getVisibleLogicalRange()
            }
          } catch (error) {
            console.error('Failed to load historical chart data', error)
            return
          }
        }
      } finally {
        isLoadingOlderDataRef.current = false
      }
    }

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
    startLiveSubscription()

    return () => {
      cancelRescale()
      stopLiveSubscription()
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
    }
  }, [
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    dataContext,
    dataParams.runtime?.refreshAt,
    listing,
    workspaceId,
    providerId,
    authParams,
    providerParams,
    normalizationMode,
    seriesWindow.interval,
    rescaleKey,
    requestInterval,
    retentionRule,
    cancelRescale,
    resetRescale,
    scheduleRescale,
    startLiveSubscription,
    stopLiveSubscription,
  ])

  return { chartError, seriesTimezone, isLoading }
}

const applySeriesData = (
  series: ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'>,
  data: ReturnType<typeof mapBarsMsToSeriesData>,
  candleType: 'area' | null,
  context: string
) => {
  const sanitized = sanitizeSeriesData(data, candleType)
  if (sanitized.length !== data.length) {
    const invalid = findFirstInvalidSeriesDatum(data, candleType)
    console.warn('[new_data_chart] Dropped invalid series data', {
      context,
      dropped: data.length - sanitized.length,
      sample: invalid?.entry ?? null,
      error: invalid?.error ?? null,
      index: invalid?.index ?? null,
    })
  }
  try {
    series.setData(sanitized as never)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[new_data_chart] Failed to set series data', { context, message })
    series.setData([] as never)
  }
}
