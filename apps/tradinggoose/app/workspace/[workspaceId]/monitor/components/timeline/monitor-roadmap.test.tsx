/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { MonitorRoadmap } from './monitor-roadmap'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

const ResizeObserverMock = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

describe('MonitorRoadmap', () => {
  let container: HTMLDivElement
  let root: Root
  let originalResizeObserver: typeof ResizeObserver | undefined

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalResizeObserver = reactActEnvironment.ResizeObserver
    reactActEnvironment.ResizeObserver = ResizeObserverMock
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalResizeObserver) {
      reactActEnvironment.ResizeObserver = originalResizeObserver
    } else {
      Reflect.deleteProperty(reactActEnvironment, 'ResizeObserver')
    }
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('selects executions from the timeline canvas', async () => {
    const onSelectExecution = vi.fn()

    await act(async () => {
      root.render(
        <MonitorRoadmap
          groups={[
            {
              id: 'success',
              label: 'Success',
              aggregates: { count: 1 },
              items: [
                {
                  id: 'log-1',
                  title: 'AAPL · Workflow One',
                  startAt: new Date('2026-04-23T00:00:00.000Z'),
                  endAt: new Date('2026-04-23T00:05:00.000Z'),
                  item: {
                    logId: 'log-1',
                    workflowId: 'wf-1',
                    executionId: 'exec-1',
                    startedAt: '2026-04-23T00:00:00.000Z',
                    endedAt: '2026-04-23T00:05:00.000Z',
                    durationMs: 300000,
                    outcome: 'success',
                    trigger: 'manual',
                    workflowName: 'Workflow One',
                    workflowColor: '#3972F6',
                    monitorId: 'monitor-1',
                    providerId: 'alpaca',
                    interval: '1m',
                    indicatorId: 'rsi',
                    assetType: 'stock',
                    listing: null,
                    listingLabel: 'AAPL',
                    cost: 0.1,
                    isOrphaned: false,
                    isPartial: true,
                    sourceLog: {
                      id: 'log-1',
                      workflowId: 'wf-1',
                      executionId: 'exec-1',
                      level: 'info',
                      trigger: 'manual',
                      startedAt: '2026-04-23T00:00:00.000Z',
                      endedAt: '2026-04-23T00:05:00.000Z',
                      durationMs: 300000,
                      outcome: 'success',
                    },
                  },
                },
              ],
            },
          ]}
          config={DEFAULT_MONITOR_VIEW_CONFIG}
          selectedExecutionLogId={null}
          controlsDisabled={false}
          onSelectExecution={onSelectExecution}
        />
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('AAPL')
    )

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected roadmap bar to render')
    }

    await act(async () => {
      button.click()
    })

    expect(onSelectExecution).toHaveBeenCalledWith('log-1')
    expect(button.textContent).toContain('Partial')
  })
})
