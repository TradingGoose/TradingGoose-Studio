'use client'

import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import { resolveListingKey, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketBar } from '@/providers/market/types'
import { intervalToMs } from '@/widgets/widgets/data_chart/series-data'
import type { DataChartCandleType } from '@/widgets/widgets/data_chart/types'
import {
  buildIndexMaps,
  mapBarMsToSeriesDatum,
  mapBarsMsToSeriesData,
  mapMarketBarToBarMs,
  mergeBarsMs,
  sanitizeSeriesData,
  sanitizeBarsMs,
} from '@/widgets/widgets/data_chart/series-data'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'
import type { ISeriesApi } from 'lightweight-charts'

type MarketLiveProvider = 'alpaca' | 'finnhub'

type MarketBarEvent = {
  provider?: string
  channel?: string
  subscriptionId?: string
  listing?: ListingIdentity
  interval?: string
  bar?: MarketBar
}

type UseLiveBarsArgs = {
  socket?: Socket | null
  workspaceId?: string | null
  providerId?: string | null
  listing: ListingIdentity | null
  interval?: string | null
  providerParams?: Record<string, unknown>
  auth?: { apiKey?: string; apiSecret?: string }
  enabled?: boolean
  candleType?: DataChartCandleType | string
  mainSeriesRef: MutableRefObject<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'> | null
  >
  dataContext: DataChartDataContext
  onError?: (message: string) => void
  onDataUpdated?: () => void
}

export const useLiveBars = ({
  socket,
  workspaceId,
  providerId,
  listing,
  interval,
  providerParams,
  auth,
  enabled = true,
  candleType,
  mainSeriesRef,
  dataContext,
  onError,
  onDataUpdated,
}: UseLiveBarsArgs) => {
  const socketRef = useRef<Socket | null>(null)
  const candleTypeRef = useRef<DataChartCandleType | string | undefined>(candleType)
  const intervalMsRef = useRef<number | null>(dataContext.intervalMs)
  const subscriptionRef = useRef<{
    subscriptionId?: string
    listingKey?: string
    listing?: ListingIdentity | null
    provider?: MarketLiveProvider
    interval?: string
    cleanup?: () => void
  } | null>(null)
  const aggregateRef = useRef<{
    bucketStartMs: number
    data: NonNullable<ReturnType<typeof mapMarketBarToBarMs>>
  } | null>(null)

  useEffect(() => {
    socketRef.current = socket ?? null
  }, [socket])

  useEffect(() => {
    candleTypeRef.current = candleType
  }, [candleType])

  useEffect(() => {
    intervalMsRef.current = dataContext.intervalMs
  }, [dataContext.intervalMs])

  const stopLiveSubscription = useCallback(() => {
    const socketInstance = socketRef.current
    const current = subscriptionRef.current
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

    subscriptionRef.current = null
    aggregateRef.current = null
  }, [])

  const startLiveSubscription = useCallback(() => {
    const liveProvider = providerId?.split('/')[0] as MarketLiveProvider | undefined
    if (!enabled || !liveProvider || !listing) return
    if (liveProvider !== 'alpaca' && liveProvider !== 'finnhub') return
    const socketInstance = socketRef.current
    if (!socketInstance) return

    const listingKey = resolveListingKey(listing)
    if (!listingKey) return

    stopLiveSubscription()
    aggregateRef.current = null

    const resolvedIntervalMs = intervalToMs(interval ?? undefined) ?? intervalMsRef.current

    const aggregateLiveData = (data: NonNullable<ReturnType<typeof mapMarketBarToBarMs>>) => {
      if (!data || !resolvedIntervalMs) return data
      const bucketStartMs = Math.floor(data.openTime / resolvedIntervalMs) * resolvedIntervalMs
      const existing = aggregateRef.current
      if (!existing || existing.bucketStartMs !== bucketStartMs) {
        const next = {
          ...data,
          openTime: bucketStartMs,
          closeTime: bucketStartMs + resolvedIntervalMs,
        }
        aggregateRef.current = { bucketStartMs, data: next }
        return next
      }

      const current = existing.data
      if (!current) return data
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

    const handleMarketBar = (payload: MarketBarEvent) => {
      const current = subscriptionRef.current
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

      const mapped = mapMarketBarToBarMs(payload.bar, resolvedIntervalMs)
      if (!mapped) return
      const aggregated = aggregateLiveData(mapped)
      if (!aggregated) return

      const previousBars = dataContext.barsMsRef.current
      const previousLastOpenTime = previousBars[previousBars.length - 1]?.openTime
      const nextBars = sanitizeBarsMs(
        mergeBarsMs(previousBars, [aggregated], resolvedIntervalMs)
      )
      dataContext.barsMsRef.current = nextBars
      const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(nextBars)
      dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
      dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex

      const series = mainSeriesRef.current
      if (series) {
        const seriesType = series.seriesType()
        const isLineSeries = seriesType === 'Area' || seriesType === 'Line'
        const shouldUpdateLatest =
          typeof previousLastOpenTime === 'number' && aggregated.openTime >= previousLastOpenTime
        if (shouldUpdateLatest) {
          const nextDatum = mapBarMsToSeriesDatum(aggregated, isLineSeries ? 'area' : null)
          const validUpdate =
            sanitizeSeriesData([nextDatum], isLineSeries ? 'area' : null).length === 1
          if (validUpdate) {
            try {
              series.update(nextDatum as never)
            } catch (error) {
              console.error('[data_chart] Failed to update live series', { error })
              const fallbackData = sanitizeSeriesData(
                mapBarsMsToSeriesData(nextBars, isLineSeries ? 'area' : null),
                isLineSeries ? 'area' : null
              )
              series.setData(fallbackData as never)
            }
          } else {
            const fallbackData = sanitizeSeriesData(
              mapBarsMsToSeriesData(nextBars, isLineSeries ? 'area' : null),
              isLineSeries ? 'area' : null
            )
            series.setData(fallbackData as never)
          }
        } else {
          const seriesData = sanitizeSeriesData(
            mapBarsMsToSeriesData(nextBars, isLineSeries ? 'area' : null),
            isLineSeries ? 'area' : null
          )
          try {
            series.setData(seriesData as never)
          } catch (error) {
            console.error('[data_chart] Failed to set live series data', { error })
            series.setData([] as never)
          }
        }
      }

      onDataUpdated?.()
    }

    const handleSubscribed = (payload: {
      subscriptionId?: string
      listing?: ListingIdentity
      provider?: MarketLiveProvider
      interval?: string
    }) => {
      const current = subscriptionRef.current
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
        onError?.(message)
      }
    }

    const handleConnect = () => {
      socketInstance.emit('market-subscribe', {
        provider: liveProvider,
        workspaceId: workspaceId ?? undefined,
        listing,
        channel: 'bars',
        interval,
        providerParams,
        auth,
      })
    }

    socketInstance.on('market-bar', handleMarketBar)
    socketInstance.on('market-subscribed', handleSubscribed)
    socketInstance.on('market-subscribe-error', handleSubscribeError)
    socketInstance.on('connect', handleConnect)

    subscriptionRef.current = {
      subscriptionId: undefined,
      listingKey,
      listing,
      provider: liveProvider,
      interval: interval ?? undefined,
      cleanup: () => {
        socketInstance.off('market-bar', handleMarketBar)
        socketInstance.off('market-subscribed', handleSubscribed)
        socketInstance.off('market-subscribe-error', handleSubscribeError)
        socketInstance.off('connect', handleConnect)
      },
    }

    handleConnect()
  }, [
    auth,
    enabled,
    interval,
    listing,
    onDataUpdated,
    onError,
    providerId,
    providerParams,
    stopLiveSubscription,
    dataContext,
    mainSeriesRef,
    workspaceId,
  ])

  useEffect(() => stopLiveSubscription, [stopLiveSubscription])

  return { startLiveSubscription, stopLiveSubscription }
}
