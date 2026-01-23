'use client'

import { type MutableRefObject, useEffect, useRef, useState } from 'react'
import type { Chart, KLineData } from 'klinecharts'
import type { Socket } from 'socket.io-client'
import { resolveListingKey, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketBar, MarketSeriesRequest, MarketSeriesWindow } from '@/providers/market/types'
import {
  clearChartData,
  fitChartToData,
  resolveProviderErrorMessage,
} from '@/widgets/widgets/data_chart/components/chart-utils'
import { DEFAULT_BAR_COUNT, intervalToMs } from '@/widgets/widgets/data_chart/remapping'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import type { resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'
import { coerceProviderParams, sanitizeNormalizationMode } from '@/widgets/widgets/data_chart/utils'

type SeriesWindow = ReturnType<typeof resolveSeriesWindow>
type MarketLiveProvider = 'alpaca' | 'finnhub'

type MarketBarEvent = {
  provider?: string
  channel?: string
  subscriptionId?: string
  listing?: ListingIdentity
  interval?: string
  bar?: MarketBar
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
  const lastDataRef = useRef<KLineData[]>([])
  const lastProviderRef = useRef<string | null>(null)
  const loaderVersionRef = useRef(0)
  const socketRef = useRef<Socket | null>(null)
  const liveSubscriptionRef = useRef<{
    subscriptionId?: string
    listingKey?: string
    listing?: ListingIdentity | null
    provider?: MarketLiveProvider
    interval?: string
    cleanup?: () => void
  } | null>(null)
  const liveAggregateRef = useRef<{
    bucketStartMs: number
    data: KLineData
  } | null>(null)

  useEffect(() => {
    socketRef.current = socket ?? null
  }, [socket])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) {
      lastProviderRef.current = providerId ?? null
      return
    }

    if (lastProviderRef.current && lastProviderRef.current !== providerId) {
      lastDataRef.current = []
      setChartError(null)
      setSeriesTimezone(null)
      clearChartData(chart)
      onProviderReset?.()
    }

    lastProviderRef.current = providerId ?? null
  }, [chartRef, onProviderReset, providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!providerId || !listing) return

    const requestInterval = seriesWindow.requestInterval
    const providerParams = coerceProviderParams(providerId, dataParams.providerParams)
    const normalizationMode = sanitizeNormalizationMode(providerId, dataParams.normalizationMode)
    loaderVersionRef.current += 1
    const loaderVersion = loaderVersionRef.current

    const mapBarToData = (bar: MarketBar | null | undefined): KLineData | null => {
      if (!bar) return null
      const timestamp = new Date(bar.timeStamp).getTime()
      if (!Number.isFinite(timestamp)) return null
      return {
        timestamp,
        open: bar.open ?? bar.close ?? 0,
        high: bar.high ?? bar.close ?? 0,
        low: bar.low ?? bar.close ?? 0,
        close: bar.close ?? bar.open ?? 0,
        volume: bar.volume ?? undefined,
        turnover: bar.turnover ?? undefined,
      } as KLineData
    }

    const mapBarsToData = (bars: any[]): KLineData[] => {
      const mapped = bars
        .map((bar: any) => mapBarToData(bar as MarketBar))
        .filter((entry: KLineData | null): entry is KLineData => Boolean(entry))

      return mapped.sort((a, b) => a.timestamp - b.timestamp)
    }

    const fetchSeriesPayload = async () => {
      let window: MarketSeriesWindow | undefined
      if (seriesWindow.dataWindow.mode === 'range') {
        window = seriesWindow.dataWindow.range
          ? { mode: 'range', range: seriesWindow.dataWindow.range }
          : undefined
      } else {
        window = {
          mode: 'bars',
          barCount: seriesWindow.dataWindow.barCount ?? DEFAULT_BAR_COUNT,
        }
      }
      const request: MarketSeriesRequest = {
        kind: 'series',
        listing,
        interval: requestInterval,
        normalizationMode,
        providerParams,
        window,
      }
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          providerNamespace: 'market',
          ...request,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(resolveProviderErrorMessage(payload, 'Failed to load series data'))
      }

      return payload
    }

    const fetchSeries = async () => {
      const payload = await fetchSeriesPayload()
      const bars = Array.isArray(payload?.bars) ? payload.bars : []
      return {
        data: mapBarsToData(bars),
        timezone: payload?.timezone,
      }
    }

    const liveEnabled = dataParams.live?.enabled !== false
    const liveProvider = providerId?.split('/')[0] as MarketLiveProvider | undefined
    const liveInterval = dataParams.live?.interval ?? seriesWindow.interval ?? requestInterval
    const liveIntervalMs = intervalToMs(liveInterval)
    const listingKey = resolveListingKey(listing)

    const aggregateLiveData = (data: KLineData): KLineData => {
      if (!liveIntervalMs) return data
      const bucketStartMs = Math.floor(data.timestamp / liveIntervalMs) * liveIntervalMs
      const existing = liveAggregateRef.current
      if (!existing || existing.bucketStartMs !== bucketStartMs) {
        const next = { ...data, timestamp: bucketStartMs }
        liveAggregateRef.current = { bucketStartMs, data: next }
        return next
      }

      const current = existing.data
      const nextHigh = data.high ?? data.close
      const nextLow = data.low ?? data.close
      if (typeof nextHigh === 'number' && Number.isFinite(nextHigh)) {
        current.high =
          typeof current.high === 'number' && Number.isFinite(current.high)
            ? Math.max(current.high, nextHigh)
            : nextHigh
      }
      if (typeof nextLow === 'number' && Number.isFinite(nextLow)) {
        current.low =
          typeof current.low === 'number' && Number.isFinite(current.low)
            ? Math.min(current.low, nextLow)
            : nextLow
      }

      if (typeof data.close === 'number' && Number.isFinite(data.close)) {
        current.close = data.close
      }

      if (typeof data.volume === 'number' && Number.isFinite(data.volume)) {
        current.volume = (current.volume ?? 0) + data.volume
      }

      if (typeof data.turnover === 'number' && Number.isFinite(data.turnover)) {
        current.turnover = (current.turnover ?? 0) + data.turnover
      }

      return current
    }

    const stopLiveSubscription = () => {
      const socketInstance = socketRef.current
      const current = liveSubscriptionRef.current
      if (!current) return
      current.cleanup?.()
      current.cleanup = undefined

      if (socketInstance) {
        if (current.subscriptionId) {
          socketInstance.emit('market-unsubscribe', { subscriptionId: current.subscriptionId })
        } else if (current.listing && current.provider) {
          socketInstance.emit('market-unsubscribe', {
            listing: current.listing,
            provider: current.provider,
          })
        }
      }

      liveSubscriptionRef.current = null
      liveAggregateRef.current = null
    }

    const startLiveSubscription = (callback: (data: KLineData) => void) => {
      if (!liveEnabled || !liveProvider || !listing || !listingKey) return
      if (liveProvider !== 'alpaca' && liveProvider !== 'finnhub') return
      const socketInstance = socketRef.current
      if (!socketInstance) return

      stopLiveSubscription()
      liveAggregateRef.current = null

      const handleMarketBar = (payload: MarketBarEvent) => {
        const current = liveSubscriptionRef.current
        if (!current) return
        if (payload?.channel && payload.channel !== 'bars') return
        if (payload.provider && payload.provider !== current.provider) return
        if (current.subscriptionId && payload.subscriptionId && payload.subscriptionId !== current.subscriptionId) {
          return
        }
        if (current.listingKey && payload.listing) {
          const payloadKey = resolveListingKey(payload.listing)
          if (payloadKey && payloadKey !== current.listingKey) return
        }
        if (current.interval && payload.interval && payload.interval !== current.interval) return

        const mapped = mapBarToData(payload.bar)
        if (!mapped) return
        const aggregated = aggregateLiveData(mapped)
        callback(aggregated)
        onDataUpdated?.()
      }

      const handleSubscribed = (payload: {
        subscriptionId?: string
        listing?: ListingIdentity
        provider?: MarketLiveProvider
        interval?: string
      }) => {
        const current = liveSubscriptionRef.current
        if (!current) return
        if (payload.provider && payload.provider !== current.provider) return
        if (current.listingKey && payload.listing) {
          const payloadKey = resolveListingKey(payload.listing)
          if (payloadKey && payloadKey !== current.listingKey) return
        }
        if (current.interval && payload.interval && payload.interval !== current.interval) return
        if (payload.subscriptionId) {
          current.subscriptionId = payload.subscriptionId
        }
      }

      const handleSubscribeError = (payload: { error?: string }) => {
        const message = payload?.error
        if (typeof message === 'string' && message.trim()) {
          setChartError(message)
        }
      }

      const handleConnect = () => {
        socketInstance.emit('market-subscribe', {
          provider: liveProvider,
          listing,
          channel: 'bars',
          interval: liveInterval,
          providerParams,
        })
      }

      socketInstance.on('market-bar', handleMarketBar)
      socketInstance.on('market-subscribed', handleSubscribed)
      socketInstance.on('market-subscribe-error', handleSubscribeError)
      socketInstance.on('connect', handleConnect)

      liveSubscriptionRef.current = {
        subscriptionId: undefined,
        listingKey,
        listing,
        provider: liveProvider,
        interval: liveInterval ?? undefined,
        cleanup: () => {
          socketInstance.off('market-bar', handleMarketBar)
          socketInstance.off('market-subscribed', handleSubscribed)
          socketInstance.off('market-subscribe-error', handleSubscribeError)
          socketInstance.off('connect', handleConnect)
        },
      }

      handleConnect()
    }

    const dataLoader = {
      getBars: async ({
        type,
        callback,
      }: {
        type: string
        callback: (data: KLineData[], more?: any) => void
      }) => {
        try {
          if (loaderVersion !== loaderVersionRef.current) return
          if (type !== 'init') {
            callback([], { backward: false, forward: false })
            return
          }

          const { data, timezone } = await fetchSeries()
          if (loaderVersion !== loaderVersionRef.current) return
          lastDataRef.current = data
          callback(data, { backward: false, forward: false })
          onDataLoaded?.(data)
          fitChartToData(chart, data, chartContainerRef.current)
          if (typeof timezone === 'string' && timezone.trim()) {
            setSeriesTimezone((prev) => (prev === timezone ? prev : timezone))
          }
          setChartError(null)
        } catch (error) {
          console.error('Failed to load chart data', error)
          const fallbackData = lastDataRef.current ?? []
          callback(fallbackData, { backward: false, forward: false })
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
      stopLiveSubscription()
    }
  }, [
    chartContainerRef,
    chartRef,
    dataParams.live?.enabled,
    dataParams.live?.interval,
    dataParams.normalizationMode,
    dataParams.providerParams,
    dataParams.refreshAt,
    listing,
    onDataLoaded,
    onDataUpdated,
    providerId,
    seriesWindow.dataWindow.barCount,
    seriesWindow.dataWindow.mode,
    seriesWindow.dataWindow.range,
    seriesWindow.interval,
    seriesWindow.requestInterval,
  ])

  return { chartError, seriesTimezone }
}
