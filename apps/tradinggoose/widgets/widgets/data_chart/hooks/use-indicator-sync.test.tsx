/** @vitest-environment jsdom */

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BarMs } from '@/widgets/widgets/data_chart/series-data'
import type { DataChartDataContext } from '@/widgets/widgets/data_chart/types'
import { useIndicatorSync } from './use-indicator-sync'

const mockExecuteBrowserPineIndicator = vi.hoisted(() => vi.fn())

vi.mock('@/lib/indicators/browser-execution', () => ({
  executeBrowserPineIndicator: mockExecuteBrowserPineIndicator,
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

function Harness({ pineCode, interval = '1m' }: { pineCode?: string; interval?: string }) {
  const chartRef = useRef(chart as any)
  const mainSeriesRef = useRef(mainSeries as any)

  useIndicatorSync({
    chartRef,
    mainSeriesRef,
    dataContext,
    interval,
    workspaceId: 'workspace-1',
    indicatorRefs: [{ id: 'custom-1', inputs: { Length: 14 } }],
    indicators: pineCode === undefined ? [] : [{ id: 'custom-1', pineCode }],
    chartReady: 1,
    indicatorRuntimeRef,
    indicatorCopy: { executionErrorFallback: 'Execution failed' } as any,
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
