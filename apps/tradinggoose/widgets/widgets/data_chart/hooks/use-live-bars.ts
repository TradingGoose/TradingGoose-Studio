'use client'

import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import type { Socket } from 'socket.io-client'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketBar } from '@/providers/market/types'
import {
  buildIndexMaps,
  intervalToMs,
  mapBarMsToSeriesDatum,
  mapBarsMsToSeriesData,
  mapMarketBarToBarMs,
  mergeBarsMs,
  sanitizeSeriesData,
} from '@/widgets/widgets/data_chart/series-data'
import type { DataChartCandleType, DataChartDataContext } from '@/widgets/widgets/data_chart/types'

type MarketLiveProvider = 'alpaca' | 'finnhub'

type MarketTradeEvent = {
  provider?: string
  channel?: string
  subscriptionId?: string
  listing?: ListingIdentity
  interval?: string
  trade?: {
    timeStamp?: string
    price?: number
    size?: number
  }
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
    listing?: ListingIdentity | null
    provider?: MarketLiveProvider
    interval?: string
    cleanup?: () => void
  } | null>(null)
  const lastTradeTimestampMsRef = useRef<number>(Number.NEGATIVE_INFINITY)

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
    lastTradeTimestampMsRef.current = Number.NEGATIVE_INFINITY
  }, [])

  const startLiveSubscription = useCallback(() => {
    const liveProvider = providerId?.split('/')[0] as MarketLiveProvider | undefined
    if (!enabled || !liveProvider || !listing) return
    if (liveProvider !== 'alpaca' && liveProvider !== 'finnhub') return
    const socketInstance = socketRef.current
    if (!socketInstance) return

    stopLiveSubscription()
    lastTradeTimestampMsRef.current = Number.NEGATIVE_INFINITY

    const resolvedIntervalMs = intervalToMs(interval ?? undefined) ?? intervalMsRef.current
    const subscribeChannel = 'trades'

    const aggregateLiveData = (data: NonNullable<ReturnType<typeof mapMarketBarToBarMs>>) => {
      if (!data || !resolvedIntervalMs) return data
      const bars = dataContext.barsMsRef.current
      const latest = bars[bars.length - 1]
      const anchorOpenTime =
        typeof latest?.openTime === 'number' && Number.isFinite(latest.openTime)
          ? latest.openTime
          : null
      const bucketStartMs =
        anchorOpenTime === null
          ? Math.floor(data.openTime / resolvedIntervalMs) * resolvedIntervalMs
          : data.openTime <= anchorOpenTime
            ? anchorOpenTime
            : anchorOpenTime +
              Math.floor((data.openTime - anchorOpenTime) / resolvedIntervalMs) * resolvedIntervalMs

      const normalized = {
        ...data,
        openTime: bucketStartMs,
        closeTime: bucketStartMs + resolvedIntervalMs,
      }

      if (!latest || latest.openTime !== bucketStartMs) {
        return normalized
      }

      const nextHigh = normalized.high ?? normalized.close
      const nextLow = normalized.low ?? normalized.close
      return {
        ...latest,
        high:
          typeof nextHigh === 'number' && Number.isFinite(nextHigh)
            ? Math.max(latest.high, nextHigh)
            : latest.high,
        low:
          typeof nextLow === 'number' && Number.isFinite(nextLow)
            ? Math.min(latest.low, nextLow)
            : latest.low,
        close: normalized.close,
        volume:
          typeof normalized.volume === 'number' && Number.isFinite(normalized.volume)
            ? (latest.volume ?? 0) + normalized.volume
            : latest.volume,
        turnover:
          typeof normalized.turnover === 'number' && Number.isFinite(normalized.turnover)
            ? (latest.turnover ?? 0) + normalized.turnover
            : latest.turnover,
        openTime: bucketStartMs,
        closeTime: bucketStartMs + resolvedIntervalMs,
      }
    }

    const applyLiveBar = (bar?: MarketBar) => {
      const mapped = mapMarketBarToBarMs(bar, resolvedIntervalMs)
      if (!mapped) return
      const aggregated = aggregateLiveData(mapped)
      if (!aggregated) return

      const previousBars = dataContext.barsMsRef.current
      const previousLastOpenTime = previousBars[previousBars.length - 1]?.openTime
      const nextBars = mergeBarsMs(previousBars, [aggregated], resolvedIntervalMs)
      dataContext.barsMsRef.current = nextBars
      const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(nextBars)
      dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
      dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex

      const series = mainSeriesRef.current
      if (series) {
        const seriesType = series.seriesType()
        const isLineSeries = seriesType === 'Area'
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

    const handleMarketTrade = (payload: MarketTradeEvent) => {
      const current = subscriptionRef.current
      if (!current) return
      if (payload?.channel && payload.channel !== 'trades') return
      if (payload.provider && payload.provider !== current.provider) return
      if (
        current.subscriptionId &&
        payload.subscriptionId &&
        payload.subscriptionId !== current.subscriptionId
      ) {
        return
      }
      if (
        current.listing &&
        payload.listing &&
        !areListingIdentitiesEqual(payload.listing, current.listing)
      ) {
        return
      }

      const trade = payload.trade
      if (!trade || typeof trade.timeStamp !== 'string') return
      if (typeof trade.price !== 'number' || !Number.isFinite(trade.price)) return
      const tradeTimestampMs = Date.parse(trade.timeStamp)
      if (!Number.isFinite(tradeTimestampMs)) return
      const latestOpenTime =
        dataContext.barsMsRef.current[dataContext.barsMsRef.current.length - 1]?.openTime
      if (typeof latestOpenTime === 'number' && Number.isFinite(latestOpenTime)) {
        if (tradeTimestampMs < latestOpenTime) return
      }
      if (tradeTimestampMs < lastTradeTimestampMsRef.current) return
      lastTradeTimestampMsRef.current = tradeTimestampMs
      const volume =
        typeof trade.size === 'number' && Number.isFinite(trade.size) ? trade.size : undefined

      applyLiveBar({
        timeStamp: trade.timeStamp,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume,
      })
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
      if (
        current.listing &&
        payload.listing &&
        !areListingIdentitiesEqual(payload.listing, current.listing)
      ) {
        return
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
        channel: subscribeChannel,
        interval,
        providerParams,
        auth,
      })
    }

    socketInstance.on('market-trade', handleMarketTrade)
    socketInstance.on('market-subscribed', handleSubscribed)
    socketInstance.on('market-subscribe-error', handleSubscribeError)
    socketInstance.on('connect', handleConnect)

    subscriptionRef.current = {
      subscriptionId: undefined,
      listing,
      provider: liveProvider,
      interval: interval ?? undefined,
      cleanup: () => {
        socketInstance.off('market-trade', handleMarketTrade)
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
