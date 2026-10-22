/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { planMarketSeriesRequest } from '@/providers/market/series-planner'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/series-window'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'
import { useChartDataLoader } from './use-chart-data-loader'
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
let controls: ReturnType<typeof useLiveBars>
let dataContext: DataChartDataContext
let loader: ReturnType<typeof useChartDataLoader>

type LoaderArgs = Parameters<typeof useChartDataLoader>[0]
const loaderArgs = (overrides: Partial<LoaderArgs> = {}): LoaderArgs => ({
  chartRef: { current: { timeScale: () => null } as any },
  chartContainerRef: { current: null },
  mainSeriesRef: { current: series as any },
  chartReady: 1,
  socket: socket as any,
  workspaceId: 'workspace-1',
  providerId: 'robinhood',
  listing,
  seriesWindow: resolveSeriesWindow({ view: { interval: '1m' } }, 'robinhood'),
  dataParams: { data: { providerParams } },
  dataContext,
  onDataUpdated,
  errorCopy: getPublicCopy('en').workspace.widgets.dataChart.errors,
  ...overrides,
})

function LoaderHarness({ args }: { args: LoaderArgs }) {
  loader = useChartDataLoader(args)
  return null
}

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
    vi.useRealTimers()
    vi.unstubAllGlobals()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps loaded history usable after a live error without waiting for another candle', async () => {
    const fetchSeries = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bars: [{ timeStamp, close: 11 }] }),
    })
    vi.stubGlobal('fetch', fetchSeries)
    await act(async () => root.render(<LoaderHarness args={loaderArgs()} />))
    const loadedBars = dataContext.barsMsRef.current
    const { clientSubscriptionId } = socket.emit.mock.calls[0][1]
    act(() => {
      handlers.get('market-error')?.({ clientSubscriptionId, message: 'Polling failed' })
    })
    expect(loader!).toMatchObject({
      chartError: null,
      liveError: 'Polling failed',
      isLoading: false,
    })
    expect(dataContext.barsMsRef.current).toBe(loadedBars)
    expect(onDataUpdated).not.toHaveBeenCalled()
    expect(fetchSeries).toHaveBeenCalledOnce()
    expect(socket.emit).toHaveBeenCalledOnce()
  })

  it.each([
    ['1970-02-01T00:00:00.000Z', '1971-07-01T00:00:00.000Z'],
    ['1970-01-01T00:00:00.000Z', '1970-01-02T00:00:00.000Z'],
    ['1969-12-31T23:59:59.999Z', '1970-01-01T00:00:00.001Z'],
  ])('preserves chart millisecond bounds through provider planning: %s', async (start, end) => {
    const fetchSeries = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bars: [{ timeStamp: end, close: 11 }] }),
    })
    vi.stubGlobal('fetch', fetchSeries)
    const args = loaderArgs({
      seriesWindow: resolveSeriesWindow({ view: { interval: '1h' } }, 'robinhood'),
      dataParams: { view: { start: Date.parse(start), end: Date.parse(end) } },
    })
    await act(async () => root.render(<LoaderHarness args={args} />))
    args.listing = { ...listing, listing_id: 'MSFT' }
    await act(async () => root.render(<LoaderHarness args={args} />))

    const request = JSON.parse(fetchSeries.mock.calls[1][1].body)
    expect(planMarketSeriesRequest('robinhood', request).window).toEqual({
      mode: 'absolute',
      startMs: Date.parse(start),
      endMs: Date.parse(end),
    })
    expect(request.windows).toEqual([{ mode: 'absolute', start, end }])
  })

  it('keeps All unbounded across listing changes and stops historical backfill', async () => {
    vi.useFakeTimers()
    const fetchSeries = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bars: [{ timeStamp, close: 11 }] }),
    })
    vi.stubGlobal('fetch', fetchSeries)
    let onRangeChange: (range: { from: number; to: number }) => Promise<void>
    const args = loaderArgs({
      providerId: 'yahoo-finance',
      seriesWindow: resolveSeriesWindow({ view: { rangePresetId: 'all' } }, 'yahoo-finance'),
      dataParams: { view: { start: openTime - 86_400_000, end: openTime } },
      chartRef: {
        current: {
          timeScale: () => ({
            subscribeVisibleLogicalRangeChange: (handler: typeof onRangeChange) => {
              onRangeChange = handler
            },
            unsubscribeVisibleLogicalRangeChange: vi.fn(),
            getVisibleLogicalRange: () => ({ from: -10, to: 10 }),
          }),
        } as any,
      },
    })
    await act(async () => root.render(<LoaderHarness args={args} />))
    args.listing = { ...listing, listing_id: 'MSFT' }
    await act(async () => root.render(<LoaderHarness args={args} />))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await onRangeChange!({ from: -10, to: 10 })
    })

    expect(fetchSeries).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchSeries.mock.calls) {
      expect(JSON.parse(init.body)).toMatchObject({ interval: '3mo', windows: [{ mode: 'all' }] })
    }
  })

  it.each([2, 3])('stops backfill at the retained cap after loading %i candles', async (count) => {
    vi.useFakeTimers()
    const retention = alpacaProviderConfig.capabilities!.series!.retention!.default!
    const previousMaxBars = retention.maxBars
    retention.maxBars = 3
    const scheduleTimeout = vi.spyOn(window, 'setTimeout')
    const fetchSeries = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bars: Array.from({ length: count }, (_, index) => ({
            timeStamp: new Date(openTime + index * 60_000).toISOString(),
            close: 11,
          })),
        }),
      })
      .mockImplementation(async (_url, init) => ({
        ok: true,
        json: async () => ({
          bars: [
            {
              timeStamp: new Date(
                Date.parse(JSON.parse(init.body).windows[0].end) - 60_000
              ).toISOString(),
              close: 10,
            },
          ],
        }),
      }))
    vi.stubGlobal('fetch', fetchSeries)
    let onRangeChange: (range: { from: number; to: number }) => Promise<void>
    let visibleRange = { from: 0, to: count - 1 }
    const args = loaderArgs({
      providerId: 'alpaca',
      seriesWindow: resolveSeriesWindow({ view: { interval: '1m' } }, 'alpaca'),
      dataParams: { data: { live: { enabled: false } } },
      chartRef: {
        current: {
          clearCrosshairPosition: vi.fn(),
          timeScale: () => ({
            subscribeVisibleLogicalRangeChange: (handler: typeof onRangeChange) => {
              onRangeChange = handler
            },
            unsubscribeVisibleLogicalRangeChange: vi.fn(),
            getVisibleLogicalRange: () => visibleRange,
            setVisibleLogicalRange: (range: typeof visibleRange) => {
              visibleRange = range
            },
          }),
        } as any,
      },
    })
    try {
      await act(async () => root.render(<LoaderHarness args={args} />))
      vi.setSystemTime(Date.now() + 200)
      await act(async () => onRangeChange!(visibleRange))
      expect(fetchSeries).toHaveBeenCalledTimes(count === 2 ? 2 : 1)
      expect(dataContext.barsMsRef.current).toHaveLength(3)
      const retainedBars = dataContext.barsMsRef.current
      expect(retainedBars[0].openTime).toBe(openTime - (count === 2 ? 60_000 : 0))
      visibleRange = { from: 0, to: 2 }
      await act(async () => {
        await onRangeChange!(visibleRange)
        await vi.advanceTimersByTimeAsync(600)
        await onRangeChange!(visibleRange)
      })
      expect(fetchSeries).toHaveBeenCalledTimes(count === 2 ? 2 : 1)
      expect(dataContext.barsMsRef.current).toBe(retainedBars)
      expect(scheduleTimeout.mock.calls.filter(([, delay]) => delay === 150)).toHaveLength(1)
    } finally {
      retention.maxBars = previousMaxBars
      scheduleTimeout.mockRestore()
    }
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
      expect(controls.liveError).toBeNull()
      act(() => {
        handlers.get('market-error')?.({ clientSubscriptionId, message: 'Polling failed' })
      })
      expect(controls.liveError).toBe('Polling failed')
      handlers.get('connect')?.()
      expect(socket.emit.mock.calls[1]).toEqual(socket.emit.mock.calls[0])
      act(() => {
        handlers.get(event)?.({ ...payload, clientSubscriptionId: 'another-chart' })
        handlers.get(event)?.({ clientSubscriptionId })
      })
      expect(controls.liveError).toBe('Polling failed')
      act(() => {
        handlers.get(event)?.({ ...payload, clientSubscriptionId })
      })
      expect(controls.liveError).toBeNull()
      expect(series.update).toHaveBeenCalledTimes(3)
      expect(onDataUpdated).toHaveBeenCalledTimes(3)
      act(() => {
        handlers.get('market-subscribe-error')?.({ clientSubscriptionId, error: 'Denied' })
      })
      expect(controls.liveError).toBe('Denied')
      act(() => controls.stopLiveSubscription())
      expect(controls.liveError).toBeNull()
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
