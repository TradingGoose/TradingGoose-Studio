/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorRoadmap } from './monitor-roadmap'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const resizeObserverMock = class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

describe('MonitorRoadmap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', resizeObserverMock)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.unstubAllGlobals()
  })

  it('renders grouped roadmap items and forwards selection clicks', async () => {
    const onSelectMonitor = vi.fn()
    const onRangeChange = vi.fn()
    const onZoomChange = vi.fn()

    await act(async () => {
      root.render(
        <MonitorRoadmap
          range='monthly'
          zoom={100}
          selectedMonitorId={null}
          onRangeChange={onRangeChange}
          onSelectMonitor={onSelectMonitor}
          onZoomChange={onZoomChange}
          groups={[
            {
              id: 'running',
              label: 'Running',
              items: [
                {
                  id: 'monitor-1',
                  groupId: 'running',
                  groupLabel: 'Running',
                  title: 'AAPL · RSI',
                  startAt: new Date('2026-04-20T00:00:00.000Z'),
                  endAt: new Date('2026-04-22T00:00:00.000Z'),
                  color: '#22c55e',
                },
              ],
            },
          ]}
        />
      )
    })

    expect(container.textContent).toContain('Running')
    expect(container.textContent).toContain('AAPL · RSI')
    expect(container.textContent).toContain('Timeline')
    expect(container.textContent).toContain('100%')

    const itemButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('AAPL · RSI')
    )

    if (!(itemButton instanceof HTMLButtonElement)) {
      throw new Error('Expected roadmap item button to render')
    }

    await act(async () => {
      itemButton.click()
    })

    expect(onSelectMonitor).toHaveBeenCalledWith('monitor-1')
    expect(onRangeChange).not.toHaveBeenCalled()
    expect(onZoomChange).not.toHaveBeenCalled()
  })
})
