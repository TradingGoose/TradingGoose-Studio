'use client'

import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { Chart, KLineData } from 'klinecharts'
import type { Socket } from 'socket.io-client'
import { resolveListingKey, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import {
  clearChartData,
  mapMarketSeriesToData,
  resolveProviderErrorMessage,
} from '@/widgets/widgets/data_chart/components/chart-utils'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import type { resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'
import {
  coerceProviderParams,
  sanitizeNormalizationMode,
} from '@/widgets/widgets/data_chart/utils'
import { useLiveBars } from '@/widgets/widgets/data_chart/components/body/use-live-bars'
import {
  assertMarketSeries,
  resolveExpectedBars,
  resolveForwardSpanMs,
  resolveSeriesSpanMs,
} from '@/widgets/widgets/data_chart/components/body/series-loader-utils'
import { useChartRescale } from '@/widgets/widgets/data_chart/components/body/use-chart-rescale'

type SeriesWindow = ReturnType<typeof resolveSeriesWindow>

const DAY_MS = 24 * 60 * 60 * 1000

const resolveRetentionRule = (
  providerId: string | null | undefined,
  interval?: string | null
) => {
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

type UseChartDataLoaderArgs = {
  chartRef: MutableRefObject<Chart | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  socket?: Socket | null
  providerId?: string | null
  listing: ListingIdentity | null
  seriesWindow: SeriesWindow
  dataParams: DataChartWidgetParams
  onProviderReset?: () => void
  onDataLoaded?: (data: KLineData[]) => void
  onDataUpdated?: () => void
}

export const useChartDataLoader = ({
  chartRef,
  chartContainerRef,
  socket,
  providerId,
  listing,
  seriesWindow,
  dataParams,
  onProviderReset,
  onDataLoaded,
  onDataUpdated,
}: UseChartDataLoaderArgs) => {
  const [chartError, setChartError] = useState<string | null>(null)
  const [seriesTimezone, setSeriesTimezone] = useState<string | null>(null)
  const lastProviderRef = useRef<string | null>(null)
  const lastListingKeyRef = useRef<string | null>(null)
  const lastWindowSpanRef = useRef<number | null>(null)
  const expectedBarsRef = useRef<number | null>(null)
  const lastRefreshAtRef = useRef<number | null>(null)
  const loaderVersionRef = useRef(0)
  const rescaleKeyRef = useRef<string | null>(null)
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
  const providerParams = useMemo(
    () => {
      if (!providerId) return undefined
      const rawParams = { ...(dataParams.data?.providerParams ?? {}) } as Record<
        string,
        unknown
      >
      delete rawParams.apiKey
      delete rawParams.apiSecret
      return coerceProviderParams(providerId, rawParams)
    },
    [dataParams.data?.providerParams, providerId]
  )
  const authParams = dataParams.data?.auth
  const normalizationMode = useMemo(
    () => {
      if (!providerId) return undefined
      const rawMode = providerParams?.normalization_mode
      const trimmedMode = typeof rawMode === 'string' ? rawMode.trim() : ''
      const capabilities = getMarketSeriesCapabilities(providerId)
      const fallbackMode = capabilities?.normalizationModes?.[0] ?? 'raw'
      const resolvedMode = trimmedMode || fallbackMode
      return sanitizeNormalizationMode(providerId, resolvedMode)
    },
    [providerId, providerParams]
  )
  const liveEnabled = dataParams.data?.live?.enabled !== false
  const liveInterval = dataParams.data?.live?.interval ?? seriesWindow.interval ?? requestInterval
  const { startLiveSubscription, stopLiveSubscription } = useLiveBars({
    socket,
    providerId,
    listing,
    interval: liveInterval,
    providerParams,
    auth: authParams,
    enabled: liveEnabled,
    onError: setChartError,
    onDataUpdated,
  })

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      lastProviderRef.current = providerId ?? null
      lastListingKeyRef.current = listingKey ?? null
      return
    }

    if (lastProviderRef.current && lastProviderRef.current !== providerId) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      clearChartData(chart)
      onProviderReset?.()
    }

    lastProviderRef.current = providerId ?? null
    const nextListingKey = listingKey ?? null
    const prevListingKey = lastListingKeyRef.current
    if (prevListingKey && prevListingKey !== nextListingKey) {
      lastWindowSpanRef.current = null
      setChartError(null)
      setSeriesTimezone(null)
      clearChartData(chart)
    }
    lastListingKeyRef.current = nextListingKey
  }, [chartRef, listingKey, onProviderReset, providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!providerId || !listing) return

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
      clearChartData(chart)
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
      clearChartData(chart)
    }

    loaderVersionRef.current += 1
    const loaderVersion = loaderVersionRef.current
    const resolveRetentionStartMs = () => {
      if (!retentionRule?.maxRangeDays || retentionRule.maxRangeDays <= 0) return null
      return Date.now() - retentionRule.maxRangeDays * DAY_MS
    }

    const fetchSeriesRequest = async (request: MarketSeriesRequest): Promise<MarketSeries> => {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          providerNamespace: 'market',
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

    const fetchSeriesRange = async (startMs: number, endMs: number): Promise<MarketSeries> => {
      const request: MarketSeriesRequest = {
        kind: 'series',
        listing,
        interval: requestInterval,
        normalizationMode,
        providerParams,
        windows: [{ mode: 'absolute', start: startMs, end: endMs }],
      }
      return fetchSeriesRequest(request)
    }

    const dataLoader = {
      getBars: async ({
        type,
        timestamp,
        callback,
      }: {
        type: string
        timestamp: number | null
        callback: (data: KLineData[], more?: any) => void
      }) => {
        try {
          if (loaderVersion !== loaderVersionRef.current) return
          if (type === 'init') {
            const series = await fetchSeries()
            if (loaderVersion !== loaderVersionRef.current) return
            const data = mapMarketSeriesToData(series)
            const retentionStartMs = resolveRetentionStartMs()
            const earliestTimestamp = data[0]?.timestamp ?? null
            const canLoadMore =
              retentionStartMs === null
                ? true
                : typeof earliestTimestamp === 'number' && earliestTimestamp > retentionStartMs
            callback(data, { backward: false, forward: canLoadMore })
            onDataLoaded?.(data)
            scheduleRescale(expectedBarsRef.current)
            lastWindowSpanRef.current = resolveSeriesSpanMs({
              series,
              interval: seriesWindow.interval ?? requestInterval,
            })
            const timezone =
              typeof series.timezone === 'string' ? series.timezone.trim() : ''
            const nextTimezone = timezone || null
            setSeriesTimezone((prev) => (prev === nextTimezone ? prev : nextTimezone))
            setChartError(null)
            return
          }

          if (type === 'forward') {
            const spanMs = resolveForwardSpanMs({
              window: seriesWindow.windows?.[0],
              interval: seriesWindow.interval ?? requestInterval,
              lastWindowSpanMs: lastWindowSpanRef.current,
            })
            const boundary =
              typeof timestamp === 'number'
                ? timestamp
                : chart.getDataList()[0]?.timestamp ?? null
            if (!spanMs || !boundary) {
              callback([], { backward: false, forward: false })
              return
            }

            const retentionStartMs = resolveRetentionStartMs()
            if (retentionStartMs !== null && boundary <= retentionStartMs) {
              callback([], { backward: false, forward: false })
              return
            }

            let startMs = Math.max(0, boundary - spanMs)
            if (retentionStartMs !== null && startMs < retentionStartMs) {
              startMs = retentionStartMs
            }
            if (startMs >= boundary) {
              callback([], { backward: false, forward: false })
              return
            }
            const series = await fetchSeriesRange(startMs, boundary)
            if (loaderVersion !== loaderVersionRef.current) return
            const data = mapMarketSeriesToData(series)
            const filtered = data.filter((bar) => bar.timestamp < boundary)
            const hasMore =
              filtered.length > 0 &&
              (retentionStartMs === null || startMs > retentionStartMs)
            callback(filtered, { backward: false, forward: hasMore })
            return
          }

          callback([], { backward: false, forward: false })
        } catch (error) {
          console.error('Failed to load chart data', error)
          if (type === 'init') {
            callback([], { backward: false, forward: false })
            setChartError(error instanceof Error ? error.message : 'Failed to load data')
            return
          }
          if (chart.getDataList().length > 0) {
            callback([], { backward: false, forward: false })
            return
          }
          callback([], { backward: false, forward: false })
          setChartError(error instanceof Error ? error.message : 'Failed to load data')
        }
      },
      subscribeBar: ({
        callback,
      }: {
        callback: (data: KLineData) => void
      }) => {
        startLiveSubscription(callback)
      },
      unsubscribeBar: () => {
        stopLiveSubscription()
      },
    }

    chart.setDataLoader(dataLoader)

    return () => {
      cancelRescale()
      stopLiveSubscription()
    }
  }, [
    chartRef,
    dataParams.runtime?.refreshAt,
    listing,
    onDataLoaded,
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

  return { chartError, seriesTimezone }
}
