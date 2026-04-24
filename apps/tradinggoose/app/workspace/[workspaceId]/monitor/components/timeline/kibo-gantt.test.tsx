/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KiboGantt } from './kibo-gantt'
import type { MonitorTimelineZoom } from '../view/view-config'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

const ResizeObserverMock = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

describe('KiboGantt', () => {
  let container: HTMLDivElement
  let root: Root
  let originalResizeObserver: typeof ResizeObserver | undefined

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalResizeObserver = reactActEnvironment.ResizeObserver
    reactActEnvironment.ResizeObserver = ResizeObserverMock
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T12:00:00.000Z'))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    if (originalResizeObserver) {
      reactActEnvironment.ResizeObserver = originalResizeObserver
    } else {
      Reflect.deleteProperty(reactActEnvironment, 'ResizeObserver')
    }
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderSingleItem = async ({
    zoom,
    scale = 100,
    startAt,
    endAt,
  }: {
    zoom: MonitorTimelineZoom
    scale?: number
    startAt: Date
    endAt: Date
  }) => {
    const onSelectItem = vi.fn()

    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'success',
              label: 'Success',
              aggregates: {
                count: 1,
                durationMs: 300000,
                cost: 0.12,
              },
              items: [
                {
                  id: 'log-1',
                  title: 'AAPL',
                  startAt,
                  endAt,
                  isOrphaned: false,
                  isPartial: false,
                  color: '#22c55e',
                },
              ],
            },
          ]}
          zoom={zoom}
          scale={scale}
          timezone='UTC'
          selectedItemId={null}
          showTodayMarker={false}
          showIntervalBoundaries
          controlsDisabled={false}
          onSelectItem={onSelectItem}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('AAPL')
    )

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected gantt item to render')
    }

    return { button, onSelectItem }
  }

  it('renders day, week, and month zoom headers and selects items', async () => {
    const { button, onSelectItem } = await renderSingleItem({
      zoom: 'week',
      startAt: new Date('2026-01-10T00:00:00.000Z'),
      endAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    expect(container.textContent).toContain('Jan')
    expect(
      container.querySelectorAll('[data-testid="kibo-timeline-column"]').length
    ).toBeGreaterThan(20)

    await act(async () => {
      button.click()
    })

    expect(onSelectItem).toHaveBeenCalledWith('log-1')
  })

  it('renders sparse 24-hour day ticks so cells do not repeat noisy labels', async () => {
    await renderSingleItem({
      zoom: 'day',
      startAt: new Date('2026-04-24T09:30:00.000Z'),
      endAt: new Date('2026-04-24T10:00:00.000Z'),
    })

    const headerGroups = Array.from(
      container.querySelectorAll('[data-testid="kibo-timeline-header-group"]')
    )
    const columns = Array.from(container.querySelectorAll('[data-testid="kibo-timeline-column"]'))
    const visibleTicks = columns
      .map((column) => column.textContent?.trim() ?? '')
      .filter(Boolean)

    expect(headerGroups.some((group) => group.textContent?.includes('Fri, Apr 24, 2026'))).toBe(
      true
    )
    expect(columns.some((column) => column.textContent?.includes('Apr'))).toBe(false)
    expect(visibleTicks.length).toBeLessThan(columns.length)
    expect(visibleTicks.some((label) => label.includes('AM') || label.includes('PM'))).toBe(false)
    expect(visibleTicks.every((label) => /^\d{2}:00$/.test(label))).toBe(true)
    expect(visibleTicks.some((label) => label === '09:00')).toBe(true)
    expect(visibleTicks.some((label) => label === '13:00')).toBe(true)
  })

  it('increases day timeline bucket density when scale increases', async () => {
    await renderSingleItem({
      zoom: 'day',
      scale: 100,
      startAt: new Date('2026-04-24T09:30:00.000Z'),
      endAt: new Date('2026-04-24T10:00:00.000Z'),
    })

    const coarseColumnCount = container.querySelectorAll(
      '[data-testid="kibo-timeline-column"]'
    ).length
    const coarseTicks = Array.from(container.querySelectorAll('[data-testid="kibo-timeline-column"]'))
      .map((column) => column.textContent?.trim() ?? '')
      .filter(Boolean)

    await renderSingleItem({
      zoom: 'day',
      scale: 180,
      startAt: new Date('2026-04-24T09:30:00.000Z'),
      endAt: new Date('2026-04-24T10:00:00.000Z'),
    })

    const denseColumnCount = container.querySelectorAll('[data-testid="kibo-timeline-column"]')
      .length
    const denseTicks = Array.from(container.querySelectorAll('[data-testid="kibo-timeline-column"]'))
      .map((column) => column.textContent?.trim() ?? '')
      .filter(Boolean)

    expect(denseColumnCount).toBeGreaterThan(coarseColumnCount)
    expect(coarseTicks).not.toContain('09:30')
    expect(denseTicks).toContain('09:30')

    await renderSingleItem({
      zoom: 'day',
      scale: 160,
      startAt: new Date('2026-04-24T09:30:00.000Z'),
      endAt: new Date('2026-04-24T10:00:00.000Z'),
    })

    const fineTicks = Array.from(container.querySelectorAll('[data-testid="kibo-timeline-column"]'))
      .map((column) => column.textContent?.trim() ?? '')
      .filter(Boolean)

    expect(fineTicks).toContain('09:30')
    expect(fineTicks).not.toContain('09:45')
  })

  it('renders month and year bands above compact month zoom date ticks', async () => {
    await renderSingleItem({
      zoom: 'month',
      scale: 60,
      startAt: new Date('2026-01-10T00:00:00.000Z'),
      endAt: new Date('2026-03-12T00:00:00.000Z'),
    })
    const columnLabels = Array.from(
      container.querySelectorAll('[data-testid="kibo-timeline-column"]')
    )
      .map((column) => column.textContent?.trim() ?? '')
      .filter(Boolean)

    expect(
      Array.from(container.querySelectorAll('[data-testid="kibo-timeline-header-group"]')).some(
        (group) => group.textContent?.includes('January 2026')
      )
    ).toBe(true)
    expect(columnLabels.every((label) => /^\d{1,2}$/.test(label))).toBe(true)
    expect(columnLabels.some((label) => label.includes('-'))).toBe(false)
    expect(columnLabels.some((label) => label.includes('Week'))).toBe(false)
  })

  it('renders the timeline grid with plain bordered cells', async () => {
    await renderSingleItem({
      zoom: 'week',
      scale: 60,
      startAt: new Date('2026-04-23T00:00:00.000Z'),
      endAt: new Date('2026-04-23T00:05:00.000Z'),
    })

    const grid = container.querySelector('[data-testid="kibo-timeline-column-grid"]')
    const column = container.querySelector('[data-testid="kibo-timeline-column"]')
    const row = container.querySelector('[data-testid="kibo-row-success"]')
    const rowGrid = container.querySelector('[data-testid="kibo-row-success-grid"]')
    const columnCount = container.querySelectorAll('[data-testid="kibo-timeline-column"]').length

    if (
      !(grid instanceof HTMLElement) ||
      !(column instanceof HTMLElement) ||
      !(row instanceof HTMLElement) ||
      !(rowGrid instanceof HTMLElement)
    ) {
      throw new Error('Expected timeline grid, column, row, and row grid to render')
    }

    expect(rowGrid.children.length).toBe(columnCount)
    expect(column.className).toContain('border-r')
    expect(column.className).toContain('border-b')
    expect(Array.from(rowGrid.children).every((cell) => cell.className.includes('border-r'))).toBe(
      true
    )
    expect(Array.from(rowGrid.children).every((cell) => cell.className.includes('border-b'))).toBe(
      true
    )
    expect(row.className).not.toContain('border-b')
    expect(container.querySelector('[data-testid="kibo-timeline-header-separators"]')).toBeNull()
    expect(container.querySelector('[data-testid="kibo-row-success-separators"]')).toBeNull()
    expect(grid.style.backgroundImage).not.toContain('repeating-linear-gradient')
    expect(row.style.backgroundImage).not.toContain('repeating-linear-gradient')
  })

  it('renders selected field sums in timeline group rows', async () => {
    await renderSingleItem({
      zoom: 'week',
      startAt: new Date('2026-04-23T00:00:00.000Z'),
      endAt: new Date('2026-04-23T00:05:00.000Z'),
    })

    expect(container.textContent).toContain('Count: 1')
    expect(container.textContent).toContain('Duration: 300000ms')
    expect(container.textContent).toContain('Cost: $0.1200')
  })

  it('shows a primary-colored today marker even when the current view has no executions', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[]}
          zoom='week'
          scale={100}
          timezone='UTC'
          selectedItemId={null}
          showTodayMarker
          showIntervalBoundaries={false}
          controlsDisabled={false}
          onSelectItem={vi.fn()}
        />
      )
    })

    const marker = container.querySelector('[data-testid="kibo-today-marker"]')
    const emptyRow = container.querySelector('[data-testid="kibo-row-current-view"]')

    expect(marker).toBeTruthy()
    expect(marker?.className).toContain('bg-primary')
    expect(emptyRow).toBeTruthy()
    expect((emptyRow as HTMLElement).style.height).toBe('32px')
    expect(container.textContent).toContain('Current view')
  })

  it('renders timeline headers using the selected timezone', async () => {
    await renderSingleItem({
      zoom: 'day',
      startAt: new Date('2026-04-23T00:00:00.000Z'),
      endAt: new Date('2026-04-23T01:00:00.000Z'),
    })

    expect(container.textContent).toContain('Thu, Apr 23, 2026')

    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'success',
              label: 'Success',
              items: [
                {
                  id: 'log-1',
                  title: 'AAPL',
                  startAt: new Date('2026-04-23T00:00:00.000Z'),
                  endAt: new Date('2026-04-23T01:00:00.000Z'),
                  isOrphaned: false,
                  isPartial: false,
                  color: '#22c55e',
                },
              ],
            },
          ]}
          zoom='day'
          scale={100}
          timezone='America/New_York'
          selectedItemId={null}
          showTodayMarker={false}
          showIntervalBoundaries
          controlsDisabled={false}
          onSelectItem={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Wed, Apr 22, 2026')
  })

  it('renders timeline range controls inside the timeline canvas', async () => {
    await renderSingleItem({
      zoom: 'week',
      startAt: new Date('2026-04-23T00:00:00.000Z'),
      endAt: new Date('2026-04-23T00:05:00.000Z'),
    })

    const controls = container.querySelector(
      '[role="menubar"][aria-label="Timeline range controls"]'
    )
    if (!(controls instanceof HTMLElement)) {
      throw new Error('Expected timeline range controls to render inside the gantt canvas')
    }

    expect(controls.textContent).toContain('Today')
    expect(controls.textContent).toContain('Week')
    expect(controls.textContent).toContain('Scale')
    expect(controls.textContent).toContain('100%')
    expect(controls.textContent).not.toContain('Markers')
    expect(controls.textContent).not.toContain('Date fields')
    expect((controls.textContent ?? '').indexOf('Scale')).toBeLessThan(
      (controls.textContent ?? '').indexOf('Week')
    )
    expect(controls.querySelector('[role="slider"]')).toBeTruthy()
    expect(
      Array.from(controls.querySelectorAll('button')).some(
        (button) => button.getAttribute('aria-label') === 'Scroll to previous date range'
      )
    ).toBe(true)
    expect(
      Array.from(controls.querySelectorAll('button')).some(
        (button) => button.getAttribute('aria-label') === 'Scroll to next date range'
      )
    ).toBe(true)
  })

  it('positions same-day executions by hour in day zoom', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'success',
              label: 'Success',
              items: [
                {
                  id: 'log-morning',
                  title: 'Morning trigger',
                  startAt: new Date('2026-04-24T09:30:00.000Z'),
                  endAt: new Date('2026-04-24T09:45:00.000Z'),
                  isOrphaned: false,
                  isPartial: false,
                  color: '#22c55e',
                },
                {
                  id: 'log-afternoon',
                  title: 'Afternoon trigger',
                  startAt: new Date('2026-04-24T14:00:00.000Z'),
                  endAt: new Date('2026-04-24T14:15:00.000Z'),
                  isOrphaned: false,
                  isPartial: false,
                  color: '#22c55e',
                },
              ],
            },
          ]}
          zoom='day'
          scale={100}
          timezone='UTC'
          selectedItemId={null}
          showTodayMarker={false}
          showIntervalBoundaries
          controlsDisabled={false}
          onSelectItem={vi.fn()}
        />
      )
    })

    const morningButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Morning trigger')
    )
    const afternoonButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Afternoon trigger')
    )

    if (
      !(morningButton instanceof HTMLButtonElement) ||
      !(afternoonButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Expected same-day gantt items to render')
    }

    const morningLeft = Number.parseFloat(morningButton.style.left)
    const afternoonLeft = Number.parseFloat(afternoonButton.style.left)

    expect(afternoonLeft - morningLeft).toBeGreaterThan(300)
  })

  it.each(['day', 'week', 'month'] as const)(
    'renders interval-boundary markers for %s zoom',
    async (zoom) => {
      await renderSingleItem({
        zoom,
        startAt: new Date('2026-01-10T12:00:00.000Z'),
        endAt: new Date('2026-09-15T12:00:00.000Z'),
      })

      expect(
        container.querySelectorAll('[data-testid="kibo-interval-boundary-marker"]').length
      ).toBeGreaterThan(0)
    }
  )

  it('scales timeline columns horizontally without changing the selected range', async () => {
    const { button } = await renderSingleItem({
      zoom: 'day',
      scale: 100,
      startAt: new Date('2026-04-24T09:00:00.000Z'),
      endAt: new Date('2026-04-24T11:00:00.000Z'),
    })

    const initialWidth = Number.parseInt(button.style.width, 10)
    expect(initialWidth).toBe(128)
    expect(button.style.height).toBe('32px')

    await renderSingleItem({
      zoom: 'day',
      scale: 140,
      startAt: new Date('2026-04-24T09:00:00.000Z'),
      endAt: new Date('2026-04-24T11:00:00.000Z'),
    })

    const scaledButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('AAPL')
    )

    if (!(scaledButton instanceof HTMLButtonElement)) {
      throw new Error('Expected scaled gantt item to render')
    }

    expect(Number.parseInt(scaledButton.style.width, 10)).toBeGreaterThan(initialWidth)
  })

  it('extends the horizontal timeline when the user scrolls near an edge', async () => {
    await renderSingleItem({
      zoom: 'week',
      startAt: new Date('2026-01-10T12:00:00.000Z'),
      endAt: new Date('2026-01-12T15:00:00.000Z'),
    })

    const scrollElement = container.querySelector('[data-testid="kibo-timeline-scroll"]')
    if (!(scrollElement instanceof HTMLDivElement)) {
      throw new Error('Expected timeline scroll element to render')
    }

    const initialColumnCount = container.querySelectorAll(
      '[data-testid="kibo-timeline-column"]'
    ).length

    Object.defineProperty(scrollElement, 'clientWidth', {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(scrollElement, 'scrollWidth', {
      configurable: true,
      value: 1000,
    })
    scrollElement.scrollLeft = 500

    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(
      container.querySelectorAll('[data-testid="kibo-timeline-column"]').length
    ).toBeGreaterThan(initialColumnCount)
  })

  it('expands dense timeline rows so stacked executions do not clip', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'success',
              label: 'Success',
              items: Array.from({ length: 8 }, (_, index) => ({
                id: `log-${index + 1}`,
                title: `Item ${index + 1}`,
                startAt: new Date('2026-01-10T00:00:00.000Z'),
                endAt: new Date('2026-01-12T00:00:00.000Z'),
                isOrphaned: false,
                isPartial: false,
                color: '#22c55e',
              })),
            },
          ]}
          zoom='day'
          scale={100}
          timezone='UTC'
          selectedItemId={null}
          showTodayMarker={false}
          showIntervalBoundaries
          controlsDisabled={false}
          onSelectItem={vi.fn()}
        />
      )
    })

    const row = container.querySelector('[data-testid="kibo-row-success"]')
    const lastButton = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Item 8')
    )

    if (!(row instanceof HTMLDivElement) || !(lastButton instanceof HTMLButtonElement)) {
      throw new Error('Expected dense gantt row to render')
    }

    expect(Number.parseInt(row.style.height, 10)).toBeGreaterThan(32)
    expect(Number.parseInt(lastButton.style.top, 10)).toBeLessThan(
      Number.parseInt(row.style.height, 10)
    )
  })
})
