/** @vitest-environment jsdom */

import { act, useMemo, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BarMs } from '@/widgets/widgets/data_chart/series-data'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'
import { useIndicatorSync } from './use-indicator-sync'

const mockExecuteBrowserPineIndicator = vi.hoisted(() => vi.fn())
const mockSetMarkers = vi.hoisted(() => vi.fn())

vi.mock('@/lib/indicators/browser-execution', () => ({
  executeBrowserPineIndicator: mockExecuteBrowserPineIndicator,
}))

vi.mock('lightweight-charts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('lightweight-charts')>()),
  createSeriesMarkers: (_series: unknown, markers: unknown[]) => {
    mockSetMarkers(markers)
    return { setMarkers: mockSetMarkers, detach: vi.fn() }
  },
}))

const bars: BarMs[] = [{ openTime: 1_000, closeTime: 2_000, open: 10, high: 12, low: 9, close: 11 }]
const dataContext: DataChartDataContext = {
  barsMsRef: { current: bars },
  indexByOpenTimeMsRef: { current: new Map([[1_000, 0]]) },
  openTimeMsByIndexRef: { current: [1_000] },
  marketSessionsRef: { current: [] },
  intervalMs: 1_000,
  seriesVersion: 1,
  dataVersion: 1,
}

let indicatorSeriesAttached = false
const mainPane = {
  paneIndex: () => 0,
  getSeries: () => [mainSeries, ...(indicatorSeriesAttached ? [indicatorSeries] : [])],
}
const mainSeries = {
  getPane: () => mainPane,
  seriesOrder: () => 0,
}
const indicatorSeries = {
  applyOptions: vi.fn(),
  getPane: () => mainPane,
  priceScale: () => ({ applyOptions: vi.fn() }),
  seriesOrder: () => 1,
  seriesType: () => 'Line',
  setData: vi.fn(),
  setSeriesOrder: vi.fn(),
}
const chart = {
  addSeries: vi.fn(() => {
    indicatorSeriesAttached = true
    return indicatorSeries
  }),
  panes: () => [mainPane],
  removePane: vi.fn(),
  removeSeries: vi.fn(() => {
    indicatorSeriesAttached = false
  }),
}
const indicatorRuntimeRef = { current: new Map() }
const indicatorRefs = [{ id: 'custom-1', inputs: { Length: 14 } }]
const indicatorCopy = { executionErrorFallback: 'Execution failed' } as any

function Harness({ pineCode, interval = '1m' }: { pineCode?: string; interval?: string }) {
  const chartRef = useRef(chart as any)
  const mainSeriesRef = useRef(mainSeries as any)
  const indicators = useMemo(
    () => (pineCode === undefined ? [] : [{ id: 'custom-1', pineCode }]),
    [pineCode]
  )

  useIndicatorSync({
    chartRef,
    mainSeriesRef,
    dataContext,
    interval,
    workspaceId: 'workspace-1',
    indicatorRefs,
    indicators,
    chartReady: 1,
    indicatorRuntimeRef,
    indicatorCopy,
  })

  return null
}

describe('useIndicatorSync live source changes', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    indicatorRuntimeRef.current = new Map()
    indicatorSeriesAttached = false
    dataContext.barsMsRef.current = bars
    dataContext.seriesVersion = 1
    dataContext.dataVersion = 1
    indicatorSeries.setData.mockClear()
    chart.addSeries.mockClear()
    chart.removeSeries.mockClear()
    mockSetMarkers.mockClear()
    mockExecuteBrowserPineIndicator.mockImplementation(async ({ barsMs }) => ({
      output: {
        series: [
          {
            plot: { title: 'Value', overlay: true, seriesType: 'Line' },
            points: barsMs.map((bar: BarMs) => ({ time: bar.openTime / 1000, value: bar.close })),
          },
        ],
        fills: [],
        markers: [],
        triggers: [],
        unsupported: { plots: [], styles: [] },
      },
      warnings: [],
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mockExecuteBrowserPineIndicator.mockReset()
    vi.useRealTimers()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })

  it.each(['same timestamps', 'shorter range', 'interval change'])(
    'replaces indicator data after a history reload with %s',
    async (change) => {
      const render = async (interval = '1m') => {
        await act(async () => root.render(<Harness pineCode='plot(close)' interval={interval} />))
      }
      dataContext.barsMsRef.current = [bars[0]!, { ...bars[0]!, openTime: 2_000 }]
      await render()
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      const interval = change === 'interval change' ? '5m' : '1m'
      await render(interval)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      const previousExecutions = mockExecuteBrowserPineIndicator.mock.calls.length

      dataContext.barsMsRef.current = dataContext.barsMsRef.current
        .slice(change === 'shorter range' ? 1 : 0)
        .map((bar) => ({ ...bar, close: 99 }))
      dataContext.seriesVersion += 1
      dataContext.dataVersion += 1
      await render(interval)
      expect(indicatorSeries.setData).toHaveBeenLastCalledWith([])
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(previousExecutions + 1)
      expect(indicatorSeries.setData).toHaveBeenLastCalledWith(
        dataContext.barsMsRef.current.map((bar) => ({ time: bar.openTime / 1000, value: 99 }))
      )
      expect(chart.removeSeries).not.toHaveBeenCalled()

      dataContext.barsMsRef.current = [
        { ...bars[0]!, openTime: 0 },
        ...dataContext.barsMsRef.current,
      ]
      dataContext.dataVersion += 1
      await render(interval)
      expect(indicatorSeries.setData.mock.lastCall?.[0]).not.toEqual([])
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(previousExecutions + 2)
    }
  )

  it.each([12, null])('updates the current candle to %s without clearing data', async (value) => {
    const render = async () => {
      await act(async () => root.render(<Harness pineCode='plot(close)' />))
      await act(async () => vi.runAllTimersAsync())
    }
    await render()
    await render()
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(1)
    indicatorSeries.setData.mockClear()

    const execute = mockExecuteBrowserPineIndicator.getMockImplementation()!
    mockExecuteBrowserPineIndicator.mockImplementationOnce(async (args) => {
      const result = await execute(args)
      result.output.series[0].points[0].value = value
      return result
    })
    dataContext.barsMsRef.current = [{ ...bars[0]!, close: 12 }]
    dataContext.dataVersion += 1
    await render()
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(2)
    expect(indicatorSeries.setData).toHaveBeenCalledExactlyOnceWith([
      value === null ? { time: 1 } : { time: 1, value },
    ])
    expect(chart.removeSeries).not.toHaveBeenCalled()
    expect(dataContext.seriesVersion).toBe(1)
    await render()
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(2)
  })

  it('preserves historical Pine markers after backfill while replacing current-candle signals', async () => {
    const { executeBrowserPineIndicator } = await vi.importActual<
      typeof import('@/lib/indicators/browser-execution')
    >('@/lib/indicators/browser-execution')
    mockExecuteBrowserPineIndicator.mockImplementation(executeBrowserPineIndicator)
    const pineCode = `indicator('Warmup Marker', { overlay: true });
const avg = ta.sma(close, 14);
const signalAvg = ta.ema(close, 50);
plot(avg, 'SMA');
plotshape(close > nz(signalAvg, 0), {style: shape.triangleup, location: location.belowbar});`
    const history = Array.from({ length: 2000 }, (_, index) => ({
      openTime: 1_700_000_000_000 + index * 60_000,
      closeTime: 1_700_000_000_000 + (index + 1) * 60_000,
      open: 100 + (index % 2),
      high: 102,
      low: 99,
      close: 100 + (index % 2),
      volume: 1,
    }))
    const obsoleteMarkerTime = history[800]!.openTime / 1000
    const renderBars = async (nextBars: BarMs[]) => {
      dataContext.barsMsRef.current = nextBars
      dataContext.dataVersion += 1
      await act(async () => root.render(<Harness pineCode={pineCode} />))
      await act(async () => vi.runAllTimersAsync())
    }
    const markerTimes = () =>
      mockSetMarkers.mock.lastCall![0].map(({ time }: { time: number }) => time)
    await renderBars(history.slice(800))
    expect(markerTimes()).toContain(obsoleteMarkerTime)
    await renderBars(history)
    expect(markerTimes()).not.toContain(obsoleteMarkerTime)
    const before = markerTimes()
    expect(before).toEqual(
      expect.arrayContaining(
        [801, 803, 805, 807, 809, 811].map((index) => history[index]!.openTime / 1000)
      )
    )
    const latest = history.at(-1)!
    expect(before).toContain(latest.openTime / 1000)
    const overlapValues = history.slice(800, 813).map((bar) => ({
      time: bar.openTime / 1000,
      value: 100.5,
    }))

    await renderBars([...history.slice(0, -1), { ...latest, close: 100 }])
    expect(mockExecuteBrowserPineIndicator.mock.lastCall![0].barsMs).toHaveLength(1200)
    expect(indicatorSeries.setData.mock.lastCall![0]).toEqual(expect.arrayContaining(overlapValues))
    expect(markerTimes()).toEqual(before.filter((time: number) => time !== latest.openTime / 1000))
  })

  it('re-executes the current bars when only the live Pine source changes', async () => {
    await act(async () => {
      root.render(<Harness pineCode="indicator('Version 1')" />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(1)
    expect(mockExecuteBrowserPineIndicator.mock.calls[0]?.[0]).toMatchObject({
      pineCode: "indicator('Version 1')",
    })
    expect(indicatorRuntimeRef.current.has('custom-1')).toBe(true)
    expect(chart.addSeries).toHaveBeenCalledWith(expect.anything(), expect.anything())

    await act(async () => {
      root.render(<Harness pineCode="indicator('Version 2')" />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(2)
    expect(mockExecuteBrowserPineIndicator.mock.calls[1]?.[0]).toMatchObject({
      pineCode: "indicator('Version 2')",
    })

    await act(async () => {
      root.render(<Harness pineCode='' />)
    })
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(2)
    expect(chart.removeSeries).toHaveBeenCalledWith(indicatorSeries)
    expect(indicatorRuntimeRef.current.has('custom-1')).toBe(false)

    await act(async () => {
      root.render(<Harness pineCode="indicator('Version 3')" />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(3)
    expect(indicatorRuntimeRef.current.has('custom-1')).toBe(true)

    await act(async () => {
      root.render(<Harness />)
    })
    expect(mockExecuteBrowserPineIndicator).toHaveBeenCalledTimes(3)
    expect(chart.removeSeries).toHaveBeenCalledTimes(2)
    expect(indicatorRuntimeRef.current.has('custom-1')).toBe(false)
  })
})
