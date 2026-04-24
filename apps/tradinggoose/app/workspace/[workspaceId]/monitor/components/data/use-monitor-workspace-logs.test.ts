/**
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogsList } from '@/hooks/queries/logs'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { useMonitorWorkspaceLogs } from './use-monitor-workspace-logs'
import type { IndicatorMonitorRecord } from '../shared/types'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

vi.mock('@/hooks/queries/logs', () => ({
  useLogsList: vi.fn(),
}))

const mockUseLogsList = vi.mocked(useLogsList)

function HookHarness({
  onRender,
  monitors = [],
  viewConfig = {
    ...DEFAULT_MONITOR_VIEW_CONFIG,
    filterQuery: 'workflow:#wf-1',
    quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
  },
}: {
  onRender: (value: ReturnType<typeof useMonitorWorkspaceLogs>) => void
  monitors?: IndicatorMonitorRecord[]
  viewConfig?: typeof DEFAULT_MONITOR_VIEW_CONFIG
}) {
  const value = useMonitorWorkspaceLogs({
    workspaceId: 'workspace-1',
    viewConfig,
    monitors,
  })

  onRender(value)
  return null
}

describe('useMonitorWorkspaceLogs', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseLogsList.mockReturnValue({
      data: {
        pages: [
          {
            logs: [
              {
                id: 'log-1',
                workflowId: 'wf-1',
                executionId: 'exec-1',
                startedAt: '2026-04-23T00:00:00.000Z',
                endedAt: '2026-04-23T00:05:00.000Z',
                durationMs: 300000,
                outcome: 'success',
                trigger: 'manual',
                workflow: { name: 'Workflow One', color: '#3972F6' },
                cost: { total: 0.12 },
                executionData: {
                  trigger: {
                    data: {
                      monitor: {
                        id: 'monitor-1',
                        providerId: 'alpaca',
                        interval: '1m',
                        indicatorId: 'rsi',
                        listing: { listing_type: 'default', listing_id: 'AAPL' },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isFetching: false,
      error: null,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as any)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.clearAllMocks()
  })

  it('merges the saved query text with quick filters before calling useLogsList', async () => {
    const snapshots: ReturnType<typeof useMonitorWorkspaceLogs>[] = []

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          onRender: (value) => {
            snapshots.push(value)
          },
        })
      )
    })

    expect(mockUseLogsList.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        details: 'full',
        queryPolicy: MONITOR_QUERY_POLICY,
        queryPolicyKey: 'monitor',
        searchQuery: expect.stringContaining('workflow:#wf-1'),
        triggerSource: 'indicator_trigger',
      })
    )
    expect(mockUseLogsList.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        searchQuery: expect.stringContaining('provider:#alpaca'),
      })
    )
    expect(snapshots.at(-1)?.executionItems[0]?.monitorId).toBe('monitor-1')
    expect(snapshots.at(-1)?.isSelectionResolved).toBe(true)
    expect(snapshots.at(-1)?.orderedVisibleLogIds).toEqual(['log-1'])
  })

  it('marks historical executions as orphaned when the source monitor no longer exists', async () => {
    const snapshots: ReturnType<typeof useMonitorWorkspaceLogs>[] = []

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          onRender: (value) => {
            snapshots.push(value)
          },
        })
      )
    })

    expect(snapshots.at(-1)?.executionItems[0]).toEqual(
      expect.objectContaining({
        monitorId: 'monitor-1',
        isOrphaned: true,
      })
    )
  })

  it('keeps loading until all execution pages are fetched and exposes layout-ordered ids', async () => {
    const fetchNextPage = vi.fn()
    mockUseLogsList.mockReturnValue({
      data: {
        pages: [
          {
            logs: [
              {
                id: 'log-1',
                workflowId: 'wf-1',
                executionId: 'exec-1',
                startedAt: '2026-04-23T00:00:00.000Z',
                endedAt: '2026-04-23T00:05:00.000Z',
                durationMs: 300000,
                outcome: 'success',
                trigger: 'manual',
                workflow: { name: 'Workflow One', color: '#3972F6' },
                cost: { total: 0.12 },
                executionData: {
                  trigger: {
                    data: {
                      monitor: {
                        id: 'monitor-1',
                        providerId: 'alpaca',
                        interval: '1m',
                        indicatorId: 'rsi',
                        listing: { listing_type: 'default', listing_id: 'AAPL' },
                      },
                    },
                  },
                },
              },
              {
                id: 'log-2',
                workflowId: 'wf-1',
                executionId: 'exec-2',
                startedAt: '2026-04-23T00:10:00.000Z',
                endedAt: '2026-04-23T00:15:00.000Z',
                durationMs: 300000,
                outcome: 'success',
                trigger: 'manual',
                workflow: { name: 'Workflow One', color: '#3972F6' },
                cost: { total: 0.08 },
                executionData: {
                  trigger: {
                    data: {
                      monitor: {
                        id: 'monitor-2',
                        providerId: 'alpaca',
                        interval: '1m',
                        indicatorId: 'rsi',
                        listing: { listing_type: 'default', listing_id: 'MSFT' },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
      isFetching: true,
      error: null,
      fetchNextPage,
      refetch: vi.fn(),
    } as any)

    const snapshots: ReturnType<typeof useMonitorWorkspaceLogs>[] = []

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          viewConfig: {
            ...DEFAULT_MONITOR_VIEW_CONFIG,
            layout: 'kanban',
            groupBy: 'outcome',
            kanban: {
              ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
              localCardOrder: {
                success: ['log-2', 'log-1'],
              },
            },
          },
          onRender: (value) => {
            snapshots.push(value)
          },
        })
      )
    })

    expect(fetchNextPage).toHaveBeenCalledOnce()
    expect(snapshots.at(-1)?.isLoading).toBe(true)
    expect(snapshots.at(-1)?.isSelectionResolved).toBe(false)
    expect(snapshots.at(-1)?.orderedVisibleLogIds).toEqual(['log-2', 'log-1'])
  })
})
