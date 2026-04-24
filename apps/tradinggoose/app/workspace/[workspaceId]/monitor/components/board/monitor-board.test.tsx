/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorBoard } from './monitor-board'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('MonitorBoard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders empty columns without a dashed empty-state message', async () => {
    await act(async () => {
      root.render(
        <MonitorBoard
          sections={[
            {
              id: 'all',
              label: 'All executions',
              columns: [
                {
                  id: 'running',
                  fieldId: 'running',
                  label: 'Running',
                  totalCount: 0,
                  aggregates: { count: 0 },
                  limit: null,
                  items: [],
                },
              ],
            },
          ]}
          selectedExecutionLogId={null}
          visibleFieldIds={['workflow']}
          timezone='UTC'
          canReorder={false}
          onSelectExecution={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Running')
    expect(container.textContent).not.toContain('No executions match this view')
    expect(container.querySelector('[aria-labelledby="column-running-title"]')).toBeTruthy()
  })

  it('selects executions and toggles quick filters from metadata chips', async () => {
    const onSelectExecution = vi.fn()
    const onToggleQuickFilter = vi.fn()

    await act(async () => {
      root.render(
        <MonitorBoard
          sections={[
            {
              id: 'all',
              label: 'All executions',
              columns: [
                {
                  id: 'success',
                  fieldId: 'success',
                  label: 'Success',
                  totalCount: 1,
                  aggregates: { count: 1 },
                  limit: null,
                  items: [
                    {
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
                      cost: 0.2,
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
                  ],
                },
              ],
            },
          ]}
          selectedExecutionLogId={null}
          visibleFieldIds={['workflow', 'provider']}
          timezone='UTC'
          canReorder={false}
          onSelectExecution={onSelectExecution}
          onToggleQuickFilter={onToggleQuickFilter}
          isQuickFilterActive={(field, value) => field === 'provider' && value === 'alpaca'}
          onReorderColumnCards={vi.fn()}
        />
      )
    })

    const card = Array.from(container.querySelectorAll('article')).find((node) =>
      node.textContent?.includes('AAPL')
    )
    const providerChip = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('alpaca')
    )

    if (!(card instanceof HTMLElement) || !(providerChip instanceof HTMLButtonElement)) {
      throw new Error('Expected monitor board card and provider chip to render')
    }

    await act(async () => {
      card.click()
      providerChip.click()
    })

    expect(onSelectExecution).toHaveBeenCalledWith('log-1')
    expect(onToggleQuickFilter).toHaveBeenCalledWith('provider', 'alpaca')
    expect(providerChip.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Snapshot incomplete')
  })

  it('formats visible execution time fields in the selected timezone', async () => {
    await act(async () => {
      root.render(
        <MonitorBoard
          sections={[
            {
              id: 'all',
              label: 'All executions',
              columns: [
                {
                  id: 'success',
                  fieldId: 'success',
                  label: 'Success',
                  totalCount: 1,
                  aggregates: { count: 1 },
                  limit: null,
                  items: [
                    {
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
                      cost: 0.2,
                      isOrphaned: false,
                      isPartial: false,
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
                  ],
                },
              ],
            },
          ]}
          selectedExecutionLogId={null}
          visibleFieldIds={['startedAt']}
          timezone='America/New_York'
          canReorder={false}
          onSelectExecution={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Apr 22, 2026')
  })
})
