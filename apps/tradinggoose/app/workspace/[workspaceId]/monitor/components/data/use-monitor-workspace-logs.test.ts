/**
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { useLogsList } from '@/hooks/queries/logs'
import type { IndicatorMonitorRecord } from '../shared/types'
import { DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG } from '../view/view-config'
import {
  buildMonitorExecutionLogFilters,
  useMonitorWorkspaceLogs,
} from './use-monitor-workspace-logs'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

vi.mock('@/hooks/queries/logs', () => ({
  useLogsList: vi.fn(),
}))

const mockUseLogsList = vi.mocked(useLogsList)

type MonitorLogFixtureOptions = {
  id?: string
  executionId?: string
  startedAt?: string
  endedAt?: string | null
  costTotal?: number
  monitorId?: string
  listingId?: string
}

const createMonitorLog = ({
  id = 'log-1',
  executionId = 'exec-1',
  startedAt = '2026-04-23T00:00:00.000Z',
  endedAt = '2026-04-23T00:05:00.000Z',
  costTotal = 0.12,
  monitorId = 'monitor-1',
  listingId = 'AAPL',
}: MonitorLogFixtureOptions = {}) => ({
  id,
  workspaceId: 'workspace-1',
  workflowId: 'wf-1',
  executionId,
  startedAt,
  endedAt,
  durationMs: 300000,
  outcome: 'success',
  trigger: 'manual',
  workflow: { name: 'Workflow One', color: '#3972F6' },
  cost: { total: costTotal },
  executionData: {
    trigger: {
      data: {
        monitor: {
          id: monitorId,
          providerId: 'alpaca',
          interval: '1m',
          indicatorId: 'rsi',
          listing: { listing_type: 'default', listing_id: listingId },
        },
      },
    },
  },
})

function HookHarness({
  onRender,
  monitors = [],
  viewConfig = {
    ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    filterQuery: 'workflow:#wf-1',
    quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
  },
}: {
  onRender: (value: ReturnType<typeof useMonitorWorkspaceLogs>) => void
  monitors?: IndicatorMonitorRecord[]
  viewConfig?: typeof DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG
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
            logs: [createMonitorLog()],
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

  it('passes the saved query text and quick filters to monitor log fetches', async () => {
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
        searchQuery: 'provider:#alpaca workflow:#wf-1',
        queryPolicy: expect.objectContaining({ key: 'monitor' }),
        queryPolicyKey: 'monitor',
        triggerSource: 'indicator_trigger',
      })
    )
    expect(snapshots.at(-1)?.executionItems[0]?.monitorId).toBe('monitor-1')
    expect(snapshots.at(-1)?.isSelectionResolved).toBe(true)
    expect(snapshots.at(-1)?.orderedVisibleLogIds).toEqual(['log-1'])
  })

  it('adds supported monitor quick filters to log request params', () => {
    const listing = JSON.stringify({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    const excludedListing = JSON.stringify({
      listing_id: '',
      base_id: 'BTC',
      quote_id: 'USD',
      listing_type: 'crypto',
    })

    const filters = buildMonitorExecutionLogFilters({
      ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      quickFilters: [
        { field: 'outcome', operator: 'include', values: ['success'] },
        { field: 'outcome', operator: 'exclude', values: ['error'] },
        { field: 'provider', operator: 'include', values: ['alpaca'] },
        { field: 'assetType', operator: 'include', values: ['stock'] },
        { field: 'monitor', operator: 'include', values: ['monitor-1'] },
        { field: 'workflow', operator: 'include', values: ['workflow-1'] },
        { field: 'trigger', operator: 'include', values: ['manual'] },
        { field: 'listing', operator: 'include', values: [listing] },
        { field: 'listing', operator: 'exclude', values: [excludedListing] },
        { field: 'provider', operator: 'exclude', values: ['tradier'] },
        { field: 'monitor', operator: 'has', values: [] },
        { field: 'interval', operator: 'no', values: [] },
      ],
    })
    const params = queryToApiParams(
      parseQuery(filters.searchQuery, MONITOR_QUERY_POLICY),
      MONITOR_QUERY_POLICY
    )

    expect(params.outcomes).toBe('success')
    expect(params.excludeOutcomes).toBe('error')
    expect(params.providerId).toBe('alpaca')
    expect(params.assetTypes).toBe('stock')
    expect(params.monitorId).toBe('monitor-1')
    expect(params.workflowIds).toBe('workflow-1')
    expect(params.triggers).toBe('manual')
    expect(JSON.parse(params.listings ?? '[]')).toEqual([JSON.parse(listing)])
    expect(JSON.parse(params.excludeListings ?? '[]')).toEqual([JSON.parse(excludedListing)])
    expect(params.excludeProviderId).toBe('tradier')
    expect(params.hasFields).toBe('monitor')
    expect(params.noFields).toBe('interval')
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

  it('reads monitor snapshots from enhanced API rows and derives endedAt from duration', async () => {
    mockUseLogsList.mockReturnValue({
      data: {
        pages: [
          {
            logs: [
              {
                id: 'log-1',
                workspaceId: 'workspace-1',
                workflowId: 'wf-1',
                executionId: 'exec-1',
                level: 'info',
                duration: '300000ms',
                trigger: 'indicator_trigger',
                createdAt: '2026-04-23T00:00:00.000Z',
                workflow: { name: 'Workflow One', color: '#3972F6' },
                cost: { total: 0.12 },
                executionData: {
                  enhanced: true,
                  totalDuration: 300000,
                  trigger: {
                    source: 'indicator_trigger',
                    data: {
                      monitor: {
                        id: 'monitor-1',
                        providerId: 'alpaca',
                        interval: '1m',
                        indicatorId: 'rsi',
                        listing: {
                          listing_type: 'default',
                          listing_id: 'AAPL',
                          assetClass: 'stock',
                        },
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

    const snapshots: ReturnType<typeof useMonitorWorkspaceLogs>[] = []

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          viewConfig: {
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            quickFilters: [{ field: 'assetType', operator: 'include', values: ['stock'] }],
          },
          monitors: [{ monitorId: 'monitor-1' } as IndicatorMonitorRecord],
          onRender: (value) => {
            snapshots.push(value)
          },
        })
      )
    })

    expect(snapshots.at(-1)?.executionItems[0]).toEqual(
      expect.objectContaining({
        monitorId: 'monitor-1',
        providerId: 'alpaca',
        interval: '1m',
        listingLabel: 'AAPL',
        assetType: 'stock',
        durationMs: 300000,
        endedAt: '2026-04-23T00:05:00.000Z',
        isOrphaned: false,
        isPartial: false,
      })
    )
    expect(snapshots.at(-1)?.orderedVisibleLogIds).toEqual(['log-1'])
  })

  it('serializes listing quick filters with canonical listing identities', async () => {
    const snapshots: ReturnType<typeof useMonitorWorkspaceLogs>[] = []

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          viewConfig: {
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            quickFilters: [
              {
                field: 'listing',
                operator: 'include',
                values: [
                  JSON.stringify({
                    listing_id: 'AAPL',
                    base_id: '',
                    quote_id: '',
                    listing_type: 'default',
                  }),
                ],
              },
            ],
          },
          onRender: (value) => {
            snapshots.push(value)
          },
        })
      )
    })

    expect(mockUseLogsList.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        searchQuery: expect.stringContaining('listing:'),
      })
    )
    expect(mockUseLogsList.mock.calls[0]?.[1].searchQuery).toContain('AAPL')
    expect(snapshots.at(-1)?.executionItems.map((item) => item.logId)).toEqual(['log-1'])
  })

  it('keeps loading until all execution pages are fetched and exposes layout-ordered ids', async () => {
    const fetchNextPage = vi.fn()
    mockUseLogsList.mockReturnValue({
      data: {
        pages: [
          {
            logs: [
              createMonitorLog(),
              createMonitorLog({
                id: 'log-2',
                executionId: 'exec-2',
                startedAt: '2026-04-23T00:10:00.000Z',
                endedAt: '2026-04-23T00:15:00.000Z',
                costTotal: 0.08,
                monitorId: 'monitor-2',
                listingId: 'MSFT',
              }),
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
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            layout: 'kanban',
            groupBy: 'outcome',
            kanban: {
              ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
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

  it('stops auto-fetching monitor execution pages at the page budget', async () => {
    const fetchNextPage = vi.fn()
    const page = {
      logs: [createMonitorLog()],
    }

    mockUseLogsList.mockReturnValue({
      data: { pages: [page, page, page] },
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
      isFetching: false,
      error: null,
      fetchNextPage,
      refetch: vi.fn(),
    } as any)

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

    expect(fetchNextPage).not.toHaveBeenCalled()
    expect(snapshots.at(-1)?.isLoading).toBe(false)
    expect(snapshots.at(-1)?.isSelectionResolved).toBe(false)
  })
})
