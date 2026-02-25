'use client'

import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { Socket } from 'socket.io-client'
import type { ListingIdentity } from '@/lib/listing/identity'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type {
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
  MarketSessionWindow,
} from '@/providers/market/types'
import { useChartRescale } from '@/widgets/widgets/data_chart/hooks/use-chart-rescale'
import { useLiveBars } from '@/widgets/widgets/data_chart/hooks/use-live-bars'
import {
  buildIndexMaps,
  DEFAULT_BAR_COUNT,
  findFirstInvalidSeriesDatum,
  intervalToMs,
  mapBarsMsToSeriesData,
  mapMarketSeriesToBarsMs,
  mergeBarsMs,
  sanitizeSeriesData,
} from '@/widgets/widgets/data_chart/series-data'
import {
  coerceProviderParams,
  sanitizeNormalizationMode,
} from '@/widgets/widgets/data_chart/series-window'
import type {
  DataChartDataContext,
  dataChartWidgetParams,
} from '@/widgets/widgets/data_chart/types'
import { resolveProviderErrorMessage } from '@/widgets/widgets/data_chart/utils/chart-errors'
import { DEFAULT_RIGHT_OFFSET } from '@/widgets/widgets/data_chart/utils/chart-styles'
import {
  assertMarketSeries,
  resolveExpectedBars,
  resolveForwardSpanMs,
  resolveSeriesSpanMs,
} from '@/widgets/widgets/data_chart/utils/series-loader'

type SeriesWindow = ReturnType<
  typeof import('@/widgets/widgets/data_chart/series-window').resolveSeriesWindow
>

const DAY_MS = 24 * 60 * 60 * 1000
const DYNAMIC_WINDOW_SEGMENTS = 3
const MAX_BACKFILL_ATTEMPTS = 6
const INITIAL_BACKFILL_COOLDOWN_MS = 150

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
  chartReady: number
  socket?: Socket | null
  workspaceId?: string | null
  providerId?: string | null
  listing: ListingIdentity | null
  seriesWindow: SeriesWindow
  dataParams: dataChartWidgetParams
  dataContext: DataChartDataContext
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
  chartReady,
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
  const lastListingSignatureRef = useRef<string | null>(null)
  const lastWindowSpanRef = useRef<number | null>(null)
  const expectedBarsRef = useRef<number | null>(null)
  const lastRefreshAtRef = useRef<number | null>(null)
  const lastSeriesLoadKeyRef = useRef<string | null>(null)
  const loaderVersionRef = useRef(0)
  const rescaleKeyRef = useRef<string | null>(null)
  const isLoadingOlderDataRef = useRef(false)
  const hasMoreHistoricalDataRef = useRef(true)
  const historicalCursorRef = useRef<number | null>(null)
  const pendingRangeRef = useRef<{ startMs: number; endMs: number } | null>(null)
  const backfillArmedAtRef = useRef<number>(Number.POSITIVE_INFINITY)
  const { resetRescale, scheduleRescale, cancelRescale } = useChartRescale({
    chartRef,
    chartContainerRef,
  })

  const requestInterval = seriesWindow.requestInterval
  const retentionRule = useMemo(
    () => resolveRetentionRule(providerId, requestInterval ?? seriesWindow.interval ?? null),
    [providerId, requestInterval, seriesWindow.interval]
  )
  const listingSignature = useMemo(() => {
    if (!listing) return null
    return `${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`
  }, [listing])
  const rangeKey = seriesWindow.windowKey ?? 'none'
  const rescaleKey = useMemo(
    () => `${listingSignature ?? 'none'}|${seriesWindow.interval ?? ''}|${rangeKey}`,
    [listingSignature, rangeKey, seriesWindow.interval]
  )
  const resolvedMarketSession = dataParams.view?.marketSession ?? 'regular'
  const providerParams = useMemo(() => {
    if (!providerId) return undefined
    const rawParams = { ...(dataParams.data?.providerParams ?? {}) } as Record<string, unknown>
    rawParams.apiKey = undefined
    rawParams.apiSecret = undefined
    rawParams.marketSession = resolvedMarketSession
    return coerceProviderParams(providerId, rawParams)
  }, [dataParams.data?.providerParams, providerId, resolvedMarketSession])
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
    backfillArmedAtRef.current = Number.POSITIVE_INFINITY
  }

  const clampPendingRange = (
    startMs: number,
    endMs: number,
    intervalMs?: number | null
  ): { startMs: number; endMs: number } | null => {
    const maxEndMs = Date.now() + (intervalMs ? intervalMs * DEFAULT_RIGHT_OFFSET : 0)
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
    const nextListingSignature = listingSignature ?? null
    const providerChanged = lastProviderRef.current !== nextProvider
    const listingChanged = lastListingSignatureRef.current !== nextListingSignature

    const shouldReusePendingRange =
      (providerChanged && lastProviderRef.current !== null) ||
      (listingChanged && lastListingSignatureRef.current !== null)

    if (shouldReusePendingRange) {
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
    } else if (providerChanged || listingChanged) {
      pendingRangeRef.current = null
    }

    if (!chart) {
      lastProviderRef.current = nextProvider
      lastListingSignatureRef.current = nextListingSignature
      return
    }

    if (providerChanged && lastProviderRef.current) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      resetHistoryState()
    }

    if (listingChanged && lastListingSignatureRef.current) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      resetHistoryState()
    }

    lastProviderRef.current = nextProvider
    lastListingSignatureRef.current = nextListingSignature
  }, [chartRef, listingSignature, providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!providerId || !listing) {
      setIsLoading(false)
      return
    }
    let isDisposed = false

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
    const isStale = () => isDisposed || loaderVersion !== loaderVersionRef.current

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

    const fetchSeries = async (): Promise<MarketSeries> => {
      const windows = seriesWindow.windows ?? []
      if (!windows.length) {
        throw new Error('Invalid time window')
      }
      return fetchSeriesRequest({
        kind: 'series',
        listing,
        interval: requestInterval,
        normalizationMode,
        providerParams,
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

    const primaryWindow = seriesWindow.windows?.[0]

    const loadSeries = async () => {
      setIsLoading(true)
      backfillArmedAtRef.current = Number.POSITIVE_INFINITY
      try {
        const pendingRange = pendingRangeRef.current
        const useExplicitRange = Boolean(pendingRange)
        if (pendingRange) {
          pendingRangeRef.current = null
          expectedBarsRef.current = null
        }
        dataContext.marketSessionsRef.current = []
        const seriesResponse =
          useExplicitRange && pendingRange
            ? await fetchSeriesRange(pendingRange.startMs, pendingRange.endMs)
            : await fetchSeries()
        if (isStale()) return
        updateMarketSessions(seriesResponse.marketSessions)
        const barsMs = mapMarketSeriesToBarsMs(seriesResponse, dataContext.intervalMs)
        dataContext.barsMsRef.current = barsMs
        const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(barsMs)
        dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
        dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex
        onDataLoaded?.()

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
        historicalCursorRef.current = null
        const expectedBars =
          primaryWindow?.mode === 'range' && typeof expectedBarsRef.current === 'number'
            ? Math.min(expectedBarsRef.current, barsMs.length)
            : expectedBarsRef.current
        scheduleRescale(expectedBars, barsMs.length)
        backfillArmedAtRef.current = Date.now() + INITIAL_BACKFILL_COOLDOWN_MS
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
        lastSeriesLoadKeyRef.current = seriesLoadKey
      } catch (error) {
        if (isStale()) return
        console.error('Failed to load chart data', error)
        setChartError(error instanceof Error ? error.message : 'Failed to load data')
      } finally {
        if (!isStale()) {
          setIsLoading(false)
        }
      }
    }

    const listingLoadKey = listing
      ? `${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`
      : 'none'
    const seriesLoadKey = [
      workspaceId ?? 'none',
      providerId ?? 'none',
      listingLoadKey,
      requestInterval ?? 'none',
      normalizationMode ?? 'none',
      seriesWindow.windowKey ?? 'none',
      JSON.stringify(providerParams ?? null),
      JSON.stringify(authParams ?? null),
      refreshAt ?? 'none',
    ].join('|')
    const shouldLoadSeries =
      refreshChanged ||
      windowChanged ||
      dataContext.barsMsRef.current.length === 0 ||
      lastSeriesLoadKeyRef.current !== seriesLoadKey

    if (shouldLoadSeries) {
      loadSeries()
    }

    let timeScale: ReturnType<IChartApi['timeScale']> | null = null
    try {
      timeScale = chart.timeScale()
    } catch {
      timeScale = null
    }

    const isFiniteLogicalRange = (
      nextRange: { from: number; to: number } | null
    ): nextRange is { from: number; to: number } =>
      Boolean(nextRange && Number.isFinite(nextRange.from) && Number.isFinite(nextRange.to))

    const readVisibleLogicalRange = () => {
      if (!timeScale) return null
      let nextRange: { from: number; to: number } | null = null
      try {
        nextRange = timeScale.getVisibleLogicalRange()
      } catch {
        return null
      }
      return isFiniteLogicalRange(nextRange) ? nextRange : null
    }

    const resolveFallbackLogicalRange = () => {
      const totalBars = dataContext.barsMsRef.current.length
      if (totalBars <= 0) return null
      const to = totalBars - 1
      const from = Math.max(0, to - (DEFAULT_BAR_COUNT - 1))
      return { from, to }
    }

    const resolveVisibleBars = (visibleRange: { from: number; to: number }) =>
      Math.max(1, Math.ceil(visibleRange.to) - Math.floor(visibleRange.from) + 1)

    const resolvePrefetchTargetBars = (visibleRange: { from: number; to: number }) =>
      resolveVisibleBars(visibleRange) * DYNAMIC_WINDOW_SEGMENTS

    const resolvePrefetchBarsNeeded = (
      visibleRange: { from: number; to: number },
      totalBars: number
    ) => {
      if (totalBars <= 0 || !hasMoreHistoricalDataRef.current) return 0

      const visibleBars = resolveVisibleBars(visibleRange)
      const targetBars = resolvePrefetchTargetBars(visibleRange)
      const maxIndex = totalBars - 1
      const fromIndexRaw = Math.floor(Math.min(visibleRange.from, visibleRange.to))
      const fromIndex = Math.max(0, Math.min(fromIndexRaw, maxIndex))
      const beforeBars = Math.max(0, fromIndex)
      const leftPaddingTarget = Math.max(0, targetBars - visibleBars)
      const leftPaddingDeficit = Math.max(0, leftPaddingTarget - beforeBars)
      const totalDeficit = Math.max(0, targetBars - totalBars)
      return Math.max(leftPaddingDeficit, totalDeficit)
    }

    const shiftLogicalRange = (range: { from: number; to: number } | null, shift: number) => {
      if (!isFiniteLogicalRange(range) || !Number.isFinite(shift)) return null
      return {
        from: range.from + shift,
        to: range.to + shift,
      }
    }

    const setHistoricalCursorFromNoGrowth = (
      requestStartMs: number,
      retentionStartMs: number | null
    ) => {
      historicalCursorRef.current = requestStartMs
      hasMoreHistoricalDataRef.current =
        retentionStartMs === null ? true : requestStartMs > retentionStartMs
    }

    const handleVisibleRangeChange = async (range: { from: number; to: number } | null) => {
      if (!timeScale) return
      if (!isFiniteLogicalRange(range)) return
      if (isStale()) return
      if (Date.now() < backfillArmedAtRef.current) return
      if (isLoadingOlderDataRef.current) return
      if (!hasMoreHistoricalDataRef.current) return

      const initialBarsNeeded = resolvePrefetchBarsNeeded(
        range,
        dataContext.barsMsRef.current.length
      )
      if (initialBarsNeeded <= 0) return

      isLoadingOlderDataRef.current = true
      let attempts = 0
      let activeRange: { from: number; to: number } | null = range
      let backfillAddedAnyBars = false

      try {
        while (activeRange && attempts < MAX_BACKFILL_ATTEMPTS) {
          const currentBars = dataContext.barsMsRef.current
          if (currentBars.length === 0) return

          const barsNeeded = resolvePrefetchBarsNeeded(activeRange, currentBars.length)
          if (barsNeeded <= 0) break
          if (!hasMoreHistoricalDataRef.current) break

          attempts += 1
          if (isStale()) return

          const oldestBar = currentBars[0]
          if (!oldestBar) return

          const baseSpanMs = resolveForwardSpanMs({
            window: seriesWindow.windows?.[0],
            interval: seriesWindow.interval ?? requestInterval,
            lastWindowSpanMs: lastWindowSpanRef.current,
          })
          const intervalMs = resolveIntervalMs()
          const requestedBars = Math.max(DEFAULT_BAR_COUNT, barsNeeded)
          const spanMs =
            intervalMs && intervalMs > 0
              ? Math.max(intervalMs, intervalMs * requestedBars)
              : baseSpanMs
          if (!spanMs) return

          const retentionStartMs = resolveRetentionStartMs()
          const boundary = historicalCursorRef.current
            ? Math.min(oldestBar.openTime, historicalCursorRef.current)
            : oldestBar.openTime
          if (!boundary) return
          let requestStartMs = Math.max(0, boundary - spanMs)
          if (retentionStartMs !== null && requestStartMs < retentionStartMs) {
            requestStartMs = retentionStartMs
          }
          const requestEndMs = boundary
          if (requestStartMs >= requestEndMs) {
            hasMoreHistoricalDataRef.current = false
            activeRange = readVisibleLogicalRange()
            continue
          }

          try {
            const seriesResponse = await fetchSeriesRange(requestStartMs, requestEndMs, true)
            if (isStale()) return
            updateMarketSessions(seriesResponse.marketSessions)
            const incomingBars = mapMarketSeriesToBarsMs(seriesResponse, dataContext.intervalMs)
            if (incomingBars.length === 0) {
              setHistoricalCursorFromNoGrowth(requestStartMs, retentionStartMs)
              activeRange = readVisibleLogicalRange()
              continue
            }

            const previousRange = readVisibleLogicalRange()
            let merged = mergeBarsMs(currentBars, incomingBars, dataContext.intervalMs)
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
            if (addedBars > 0) backfillAddedAnyBars = true

            if (mainSeriesRef.current) {
              const series = mainSeriesRef.current
              const seriesType = series.seriesType()
              const isLineSeries = seriesType === 'Area'
              const seriesData = mapBarsMsToSeriesData(merged, isLineSeries ? 'area' : null)
              applySeriesData(series, seriesData, isLineSeries ? 'area' : null, 'backfill')
            }
            try {
              chart.clearCrosshairPosition()
            } catch {
              return
            }

            if (addedBars <= 0) {
              setHistoricalCursorFromNoGrowth(requestStartMs, retentionStartMs)
              activeRange = readVisibleLogicalRange()
              continue
            }

            const shiftedRange = shiftLogicalRange(previousRange, addedBars)
            if (shiftedRange) {
              try {
                timeScale.setVisibleLogicalRange(shiftedRange)
              } catch {
                return
              }
              activeRange = shiftedRange
            } else {
              activeRange = readVisibleLogicalRange()
            }

            const earliestTimestamp = merged[0]?.openTime ?? null
            hasMoreHistoricalDataRef.current =
              retentionStartMs === null
                ? incomingBars.length > 0
                : typeof earliestTimestamp === 'number' && earliestTimestamp > retentionStartMs
            if (!activeRange) {
              activeRange = readVisibleLogicalRange()
            }
          } catch (error) {
            console.error('Failed to load chart prefill data', error)
            return
          }
        }
        if (backfillAddedAnyBars && !isStale()) {
          onDataBackfill?.()
        }
      } finally {
        isLoadingOlderDataRef.current = false
      }
    }

    let initialPrefillTimer: number | null = null
    const scheduleInitialPrefillPass = (delayMs = 150) => {
      if (initialPrefillTimer !== null) window.clearTimeout(initialPrefillTimer)
      initialPrefillTimer = window.setTimeout(
        () => void runInitialPrefillPass(),
        Math.max(0, delayMs)
      )
    }

    const runInitialPrefillPass = async () => {
      if (isStale()) return
      if (
        !Number.isFinite(backfillArmedAtRef.current) ||
        Date.now() < backfillArmedAtRef.current ||
        isLoadingOlderDataRef.current
      ) {
        scheduleInitialPrefillPass(150)
        return
      }
      if (!hasMoreHistoricalDataRef.current) return

      const visibleRange = readVisibleLogicalRange() ?? resolveFallbackLogicalRange()
      if (!visibleRange) {
        scheduleInitialPrefillPass(150)
        return
      }
      if (resolvePrefetchBarsNeeded(visibleRange, dataContext.barsMsRef.current.length) <= 0) return

      await handleVisibleRangeChange(visibleRange)

      if (isStale()) return
      const nextVisibleRange = readVisibleLogicalRange() ?? visibleRange
      if (
        hasMoreHistoricalDataRef.current &&
        resolvePrefetchBarsNeeded(nextVisibleRange, dataContext.barsMsRef.current.length) > 0
      ) {
        scheduleInitialPrefillPass(150)
      }
    }

    if (timeScale) {
      timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
      scheduleInitialPrefillPass(
        Number.isFinite(backfillArmedAtRef.current)
          ? Math.max(0, backfillArmedAtRef.current - Date.now())
          : 150
      )
    }
    startLiveSubscription()

    return () => {
      isDisposed = true
      loaderVersionRef.current += 1
      cancelRescale()
      stopLiveSubscription()
      if (timeScale) {
        try {
          timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
        } catch {
          // Ignore disposal races during chart teardown.
        }
      }
      if (initialPrefillTimer !== null) {
        window.clearTimeout(initialPrefillTimer)
      }
    }
  }, [
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartReady,
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
    console.warn('[data_chart] Dropped invalid series data', {
      context,
      dropped: data.length - sanitized.length,
      sample: invalid?.entry ?? null,
      error: invalid?.error ?? null,
      index: invalid?.index ?? null,
    })
  }

  const safeSetEmpty = () => {
    try {
      series.setData([] as never)
    } catch {
      // Ignore cleanup errors from transient/disposed series state.
    }
  }

  try {
    series.setData(sanitized as never)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[data_chart] Failed to set series data', {
      context,
      message,
      points: sanitized.length,
    })
    safeSetEmpty()
  }
}
