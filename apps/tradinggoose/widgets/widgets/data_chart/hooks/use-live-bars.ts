'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import type { Socket } from 'socket.io-client'
import type { ListingIdentity } from '@/lib/listing/identity'
import { getMarketLiveCapabilities } from '@/providers/market/providers'
import type { MarketBar, NormalizationMode } from '@/providers/market/types'
import {
  type BarMs,
  buildIndexMaps,
  intervalToMs,
  mapBarMsToSeriesDatum,
  mapBarsMsToSeriesData,
  mapMarketBarToBarMs,
  mergeBarsMs,
} from '@/widgets/widgets/data_chart/series-data'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'

type MarketLiveEvent = {
  clientSubscriptionId?: string
  bar?: MarketBar
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
  normalizationMode?: NormalizationMode
  providerParams?: Record<string, unknown>
  auth?: { apiKey?: string; apiSecret?: string }
  enabled?: boolean
  mainSeriesRef: MutableRefObject<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'> | null
  >
  dataContext: DataChartDataContext
  onDataUpdated?: () => void
}

export const useLiveBars = ({
  socket,
  workspaceId,
  providerId,
  listing,
  interval,
  normalizationMode,
  providerParams,
  auth,
  enabled = true,
  mainSeriesRef,
  dataContext,
  onDataUpdated,
}: UseLiveBarsArgs) => {
  const cleanupRef = useRef<(() => void) | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)

  const stopLiveSubscription = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setLiveError(null)
  }, [])

  const startLiveSubscription = useCallback(() => {
    stopLiveSubscription()
    if (!enabled || !providerId || !listing || !socket) return
    const channels = getMarketLiveCapabilities(providerId)?.channels
    const subscribeChannel = channels?.includes('trades')
      ? 'trades'
      : channels?.includes('bars')
        ? 'bars'
        : null
    if (!subscribeChannel) return
    const clientSubscriptionId = crypto.randomUUID()
    const event = subscribeChannel === 'trades' ? 'market-trade' : 'market-bar'
    let lastTradeTimestampMs = Number.NEGATIVE_INFINITY

    const resolvedIntervalMs = intervalToMs(interval) ?? dataContext.intervalMs

    const aggregateLiveData = (data: BarMs) => {
      if (!resolvedIntervalMs) return data
      const bars = dataContext.barsMsRef.current
      const latest = bars[bars.length - 1]
      const bucketStartMs = latest
        ? latest.openTime +
          Math.floor((data.openTime - latest.openTime) / resolvedIntervalMs) * resolvedIntervalMs
        : Math.floor(data.openTime / resolvedIntervalMs) * resolvedIntervalMs

      const normalized = {
        ...data,
        openTime: bucketStartMs,
        closeTime: bucketStartMs + resolvedIntervalMs,
      }

      if (!latest || latest.openTime !== bucketStartMs) {
        return normalized
      }

      return {
        ...latest,
        high: Math.max(latest.high, normalized.high),
        low: Math.min(latest.low, normalized.low),
        close: normalized.close,
        volume:
          normalized.volume !== undefined
            ? (latest.volume ?? 0) + normalized.volume
            : latest.volume,
        openTime: bucketStartMs,
        closeTime: bucketStartMs + resolvedIntervalMs,
      }
    }

    const applyLiveBar = (bar?: MarketBar) => {
      const mapped = mapMarketBarToBarMs(bar, resolvedIntervalMs)
      if (!mapped) return
      const aggregated = subscribeChannel === 'trades' ? aggregateLiveData(mapped) : mapped

      const previousBars = dataContext.barsMsRef.current
      const previousLastOpenTime = previousBars[previousBars.length - 1]?.openTime
      const nextBars = mergeBarsMs(previousBars, [aggregated], resolvedIntervalMs)
      dataContext.barsMsRef.current = nextBars
      const { indexByOpenTimeMs, openTimeMsByIndex } = buildIndexMaps(nextBars)
      dataContext.indexByOpenTimeMsRef.current = indexByOpenTimeMs
      dataContext.openTimeMsByIndexRef.current = openTimeMsByIndex

      const series = mainSeriesRef.current
      if (series) {
        const candleType = series.seriesType() === 'Area' ? 'area' : null
        if (previousLastOpenTime !== undefined && aggregated.openTime >= previousLastOpenTime) {
          series.update(mapBarMsToSeriesDatum(aggregated, candleType) as never)
        } else {
          series.setData(mapBarsMsToSeriesData(nextBars, candleType) as never)
        }
      }

      setLiveError(null)
      onDataUpdated?.()
    }

    const handleMarketData = (payload: MarketLiveEvent) => {
      if (payload.clientSubscriptionId !== clientSubscriptionId) return
      if (subscribeChannel === 'bars') {
        applyLiveBar(payload.bar)
        return
      }

      const trade = payload.trade
      if (!trade || typeof trade.timeStamp !== 'string') return
      if (typeof trade.price !== 'number' || !Number.isFinite(trade.price)) return
      const tradeTimestampMs = Date.parse(trade.timeStamp)
      if (!Number.isFinite(tradeTimestampMs)) return
      const latestOpenTime =
        dataContext.barsMsRef.current[dataContext.barsMsRef.current.length - 1]?.openTime
      if (latestOpenTime !== undefined && tradeTimestampMs < latestOpenTime) return
      if (tradeTimestampMs < lastTradeTimestampMs) return
      lastTradeTimestampMs = tradeTimestampMs

      applyLiveBar({
        timeStamp: trade.timeStamp,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.size,
      })
    }

    const handleError = (payload: {
      clientSubscriptionId?: string
      error?: string
      message?: string
    }) => {
      if (payload.clientSubscriptionId !== clientSubscriptionId) return
      const message = payload.error ?? payload.message
      if (typeof message === 'string' && message.trim()) {
        setLiveError(message)
      }
    }

    const handleConnect = () => {
      socket.emit('market-subscribe', {
        clientSubscriptionId,
        provider: providerId,
        workspaceId: workspaceId ?? undefined,
        listing,
        channel: subscribeChannel,
        interval,
        normalizationMode,
        providerParams,
        auth,
      })
    }

    socket.on(event, handleMarketData)
    socket.on('market-subscribe-error', handleError)
    socket.on('market-error', handleError)
    socket.on('connect', handleConnect)

    cleanupRef.current = () => {
      socket.off(event, handleMarketData)
      socket.off('market-subscribe-error', handleError)
      socket.off('market-error', handleError)
      socket.off('connect', handleConnect)
      socket.emit('market-unsubscribe', { clientSubscriptionId })
    }

    handleConnect()
  }, [
    auth,
    enabled,
    interval,
    listing,
    normalizationMode,
    onDataUpdated,
    providerId,
    providerParams,
    socket,
    stopLiveSubscription,
    dataContext,
    mainSeriesRef,
    workspaceId,
  ])

  useEffect(() => stopLiveSubscription, [stopLiveSubscription])

  return { startLiveSubscription, stopLiveSubscription, liveError }
}
