/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'
import { useLiveBars } from './use-live-bars'

const listing = { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' as const }
const timeStamp = '2026-09-22T14:00:00Z'
const openTime = Date.parse(timeStamp)
const providerParams = { credentialId: 'connection', marketSession: 'extended' }
const handlers = new Map<string, (payload?: any) => void>()
const socket = {
  emit: vi.fn(),
  on: (event: string, handler: (payload?: any) => void) => handlers.set(event, handler),
  off: (event: string) => handlers.delete(event),
}
const series = { seriesType: () => 'Candlestick', update: vi.fn(), setData: vi.fn() }
const onDataUpdated = vi.fn()
const onError = vi.fn()
let controls: ReturnType<typeof useLiveBars>
let dataContext: DataChartDataContext

function Harness({ providerId, enabled = true }: { providerId: string; enabled?: boolean }) {
  controls = useLiveBars({
    socket: socket as any,
    workspaceId: 'workspace-1',
    providerId,
    listing,
    interval: '1m',
    normalizationMode: 'raw',
    providerParams,
    enabled,
    mainSeriesRef: { current: series as any },
    dataContext,
    onDataUpdated,
    onError,
  })
  return null
}

describe('useLiveBars', () => {
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    handlers.clear()
    root = createRoot(document.createElement('div'))
    dataContext = {
      barsMsRef: {
        current: [
          {
            openTime,
            closeTime: openTime + 60_000,
            open: 10,
            high: 12,
            low: 9,
            close: 11,
            volume: 10,
          },
        ],
      },
      indexByOpenTimeMsRef: { current: new Map([[openTime, 0]]) },
      openTimeMsByIndexRef: { current: [openTime] },
      marketSessionsRef: { current: [] },
      intervalMs: 60_000,
      seriesVersion: 1,
      dataVersion: 1,
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })

  it.each(['robinhood', 'alpaca', 'finnhub'])(
    'updates %s through its supported channel',
    (providerId) => {
      act(() => root.render(<Harness providerId={providerId} />))
      controls.startLiveSubscription()
      const channel = providerId === 'robinhood' ? 'bars' : 'trades'
      const event = channel === 'bars' ? 'market-bar' : 'market-trade'
      expect(socket.emit).toHaveBeenCalledWith(
        'market-subscribe',
        expect.objectContaining({
          provider: providerId,
          channel,
          interval: '1m',
          normalizationMode: 'raw',
          providerParams,
        })
      )
      const { clientSubscriptionId } = socket.emit.mock.calls[0][1]
      expect(clientSubscriptionId).toEqual(expect.any(String))
      const payload =
        channel === 'bars'
          ? { bar: { timeStamp, open: 10, high: 15, low: 8, close: 14, volume: 20 } }
          : { trade: { timeStamp, price: 14, size: 2 } }
      handlers.get(event)?.({ ...payload, clientSubscriptionId: 'another-chart' })
      handlers.get(event)?.({
        clientSubscriptionId,
        [channel === 'bars' ? 'bar' : 'trade']: { timeStamp: 'invalid', price: Number.NaN },
      })
      expect(onDataUpdated).not.toHaveBeenCalled()
      handlers.get(event)?.({ ...payload, clientSubscriptionId })
      handlers.get(event)?.({
        clientSubscriptionId,
        ...(channel === 'bars'
          ? { bar: { timeStamp, open: 10, high: 13, low: 9, close: 12, volume: 24 } }
          : { trade: { timeStamp, price: 12, size: 3 } }),
      })
      expect(dataContext.barsMsRef.current).toEqual([
        expect.objectContaining({
          openTime,
          open: 10,
          high: channel === 'bars' ? 13 : 14,
          low: 9,
          close: 12,
          volume: channel === 'bars' ? 24 : 15,
        }),
      ])
      expect(series.update).toHaveBeenCalledTimes(2)
      expect(onDataUpdated).toHaveBeenCalledTimes(2)
      handlers.get('market-subscribe-error')?.({
        clientSubscriptionId: 'another-chart',
        error: 'ignore',
      })
      handlers.get('market-error')?.({ clientSubscriptionId, message: 'Connection revoked' })
      expect(onError).toHaveBeenCalledExactlyOnceWith('Connection revoked')
      handlers.get('connect')?.()
      expect(socket.emit.mock.calls[1]).toEqual(socket.emit.mock.calls[0])
      controls.stopLiveSubscription()
      expect(socket.emit).toHaveBeenLastCalledWith('market-unsubscribe', { clientSubscriptionId })
      expect(handlers.size).toBe(0)
    }
  )

  it.each(['initial', 'historical'])('inserts and corrects an %s candle', (mode) => {
    act(() => root.render(<Harness providerId='robinhood' />))
    controls.startLiveSubscription()
    if (mode === 'initial') dataContext.barsMsRef.current = []
    const newerBars = dataContext.barsMsRef.current
    const { clientSubscriptionId } = socket.emit.mock.calls[0][1]
    handlers.get('market-bar')?.({
      clientSubscriptionId,
      bar: { timeStamp: '2026-09-22T13:59:00Z', open: 9, high: 12, low: 8, close: 10, volume: 10 },
    })
    expect(series.setData).toHaveBeenCalledExactlyOnceWith([
      { time: openTime / 1000 - 60, open: 9, high: 12, low: 8, close: 10 },
      ...(mode === 'initial'
        ? []
        : [{ time: openTime / 1000, open: 10, high: 12, low: 9, close: 11 }]),
    ])
    expect(series.update).not.toHaveBeenCalled()
    expect(onDataUpdated).toHaveBeenCalledTimes(1)
    handlers.get('market-bar')?.({
      clientSubscriptionId,
      bar: { timeStamp: '2026-09-22T13:59:00Z', open: 9, high: 14, low: 7, close: 13, volume: 20 },
    })
    expect(dataContext.barsMsRef.current).toEqual([
      expect.objectContaining({
        openTime: openTime - 60_000,
        open: 9,
        high: 14,
        low: 7,
        close: 13,
        volume: 20,
      }),
      ...newerBars,
    ])
    expect(onDataUpdated).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['yahoo-finance', true],
    ['robinhood', false],
  ] as const)('does not subscribe %s when live candles are unavailable', (providerId, enabled) => {
    act(() => root.render(<Harness providerId={providerId} enabled={enabled} />))
    controls.startLiveSubscription()
    expect(socket.emit).not.toHaveBeenCalled()
  })
})
