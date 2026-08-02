/**
 * @vitest-environment jsdom
 */

import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildLogsRequestParams: vi.fn(() => 'workspaceId=workspace-1'),
  buildOrdersRequestParams: vi.fn(() => 'workspaceId=workspace-1'),
  fetchNextPage: vi.fn(),
  folderIds: [] as string[],
  foldersData: [],
  getFolderTree: vi.fn(() => []),
  initializeFromURL: vi.fn(),
  orderDetailRefetch: vi.fn(),
  ordersRefetch: vi.fn(),
  setSearchQuery: vi.fn(),
  setWorkspaceId: vi.fn(),
  triggers: [] as string[],
  useLogDetail: vi.fn(),
  useLogsList: vi.fn(),
  useOrderDetail: vi.fn(),
  useOrdersList: vi.fn(),
  workflowDetailsProps: null as any,
  workflowIds: [] as string[],
  workflowListProps: null as any,
}))

const order = { id: 'order-1' }

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('next/font/local', () => ({ default: () => ({ className: '' }) }))

vi.mock('@/components/ui/resizable', () => ({
  ResizableHandle: () => <div data-testid='resize-handle' />,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, render }: any) => <>{render ?? children}</>,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children, render }: any) =>
    render ? cloneElement(render, undefined, children) : <>{children}</>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/log-details/log-details', () => ({
  LogDetails: ({ log }: any) => <div data-testid='log-details'>{log?.id}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/logs-list', () => ({
  LogsList: () => <div data-testid='logs-list'>logs-list</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/logs-toolbar', () => ({
  AutocompleteSearch: ({ value }: any) => <div data-testid='log-search'>{value}</div>,
  LogsToolbar: ({ center, left, right }: any) => <div>{[left, center, right]}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/orders', () => ({
  OrderDetails: ({ mode, order }: any) => (
    <div data-testid='order-details'>{`${order.id}:${mode}`}</div>
  ),
  OrderFilterMenu: ({ state }: any) => (
    <div data-side={state.side} data-testid='order-filter-menu' />
  ),
  OrderFilters: () => null,
  OrdersTable: ({ onOrderClick, orders }: any) => (
    <button data-testid='orders-table' onClick={() => onOrderClick(orders[0])} type='button'>
      {orders[0].id}
    </button>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/stats', () => ({
  Stats: ({ live, refreshRequest, searchQuery }: any) => (
    <div
      data-live={String(live)}
      data-refresh-request={String(refreshRequest)}
      data-search-query={searchQuery}
      data-testid='stats-view'
    />
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/records/components/stats/components/logs-filters/logs-filters',
  () => ({
    LogsFilters: () => <div data-testid='stats-filters'>stats-filters</div>,
  })
)

vi.mock('@/app/workspace/[workspaceId]/records/components/stats/components/line-chart', () => ({
  default: () => <div data-testid='workflow-line-chart' />,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/records/components/stats/components/workflow-details',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    default: (props: any) => {
      if (props.expandedWorkflowId !== 'all') mocks.workflowDetailsProps = props
      return null
    },
  })
)

vi.mock('@/app/workspace/[workspaceId]/records/components/stats/components/workflows-list', () => ({
  default: (props: any) => {
    mocks.workflowListProps = props
    return null
  },
}))

vi.mock('@/hooks/queries/folders', () => ({
  useFolders: () => ({ data: mocks.foldersData }),
}))

vi.mock('@/hooks/queries/logs', () => ({
  buildLogsRequestParams: (...args: unknown[]) => (mocks.buildLogsRequestParams as any)(...args),
  useLogDetail: (...args: unknown[]) => mocks.useLogDetail(...args),
  useLogsList: (...args: unknown[]) => mocks.useLogsList(...args),
}))

vi.mock('@/hooks/queries/records-orders', () => ({
  buildOrdersRequestParams: (...args: unknown[]) =>
    (mocks.buildOrdersRequestParams as any)(...args),
  useOrderDetail: (...args: unknown[]) => mocks.useOrderDetail(...args),
  useOrdersList: (...args: unknown[]) => mocks.useOrdersList(...args),
}))

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: unknown) => value,
}))

vi.mock('@/stores/folders/store', () => ({
  useFolderStore: () => ({
    getFolderTree: mocks.getFolderTree,
  }),
}))

vi.mock('@/stores/logs/filters/store', () => ({
  useFilterStore: () => ({
    folderIds: mocks.folderIds,
    initializeFromURL: mocks.initializeFromURL,
    level: [],
    searchQuery: '',
    setSearchQuery: mocks.setSearchQuery,
    setWorkspaceId: mocks.setWorkspaceId,
    timeRange: 'all',
    triggers: mocks.triggers,
    workflowIds: mocks.workflowIds,
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Records', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    window.history.pushState({}, '', '/workspace/workspace-1/records')
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: [] }),
      ok: true,
    }) as any
    mocks.fetchNextPage.mockReset()
    mocks.initializeFromURL.mockReset()
    mocks.orderDetailRefetch.mockReset()
    mocks.ordersRefetch.mockReset()
    mocks.setSearchQuery.mockReset()
    mocks.setWorkspaceId.mockReset()
    mocks.triggers = []
    mocks.workflowDetailsProps = null
    mocks.workflowListProps = null
    reactActEnvironment.ResizeObserver = class {
      disconnect() {}
      observe() {}
    } as any
    mocks.useOrderDetail.mockReturnValue({ data: null, refetch: mocks.orderDetailRefetch })
    mocks.useLogDetail.mockReturnValue({ data: null, refetch: vi.fn() })
    mocks.useLogsList.mockReturnValue({
      data: { pages: [{ hasMore: false, logs: [], nextPage: undefined, total: 0 }] },
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    mocks.useOrdersList.mockReturnValue({
      data: { pages: [{ hasMore: false, nextPage: undefined, orders: [order], total: 1 }] },
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.ordersRefetch,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    Reflect.deleteProperty(reactActEnvironment, 'ResizeObserver')
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderRecords = async () => {
    const { default: Records } = await import('./records')
    await act(async () => {
      root.render(<Records />)
      await flush()
    })
  }

  const renderWorkflowDetails = async (overrides: any = {}) => {
    const { WorkflowDetails } = await import('./components/stats/components/workflow-details')
    const props = {
      expandedWorkflowId: 'workflow-1',
      overview: { total: 0, success: 0, failures: 0, rate: 100 },
      ...overrides,
    }
    await act(async () => {
      root.render(<WorkflowDetails {...(props as any)} />)
      await flush()
    })
  }

  it('reloads workflow details when a pending page query is reentered', async () => {
    const response = (body: unknown) => ({ json: async () => body, ok: true })
    const pending = [deferred<any>(), deferred<any>(), deferred<any>()]
    const detailRequests: [string, string | null][] = []
    global.fetch = vi.fn((input) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.includes('/metrics/executions'))
        return Promise.resolve(
          response({ workflows: [{ segments: [], workflowId: 'workflow-1' }] })
        )
      if (url.searchParams.get('workflowIds') !== 'workflow-1')
        return Promise.resolve(response({ data: [], total: 0 }))
      detailRequests.push([url.searchParams.get('offset') ?? '0', url.searchParams.get('triggers')])
      if (detailRequests.length === 1)
        return Promise.resolve(response({ data: [{ id: 'initial' }], total: 2 }))
      return pending[detailRequests.length - 2]?.promise
    }) as any

    const { Stats } = await import('./components/stats/stats')
    const statsProps = { onRefetchingChange: vi.fn(), searchQuery: '' } as any
    const renderStats = async (triggers: string[]) => {
      mocks.triggers = triggers
      await act(async () => {
        root.render(<Stats {...statsProps} />)
        await flush()
        await flush()
      })
    }

    await renderStats([])
    await act(async () => {
      mocks.workflowListProps.onToggleWorkflow('workflow-1')
      await flush()
      await flush()
    })
    expect(detailRequests).toHaveLength(1)
    await act(async () => {
      mocks.workflowDetailsProps.onLoadMore()
      await flush()
    })
    expect([detailRequests.length, mocks.workflowDetailsProps.isLoadingMore]).toEqual([2, true])

    await renderStats(['api'])
    await renderStats([])
    expect(detailRequests).toEqual([
      ['0', null],
      ['1', null],
      ['0', 'api'],
      ['0', null],
    ])

    await act(async () => {
      pending[0].resolve(response({ data: [{ id: 'stale-page' }], total: 2 }))
      pending[1].resolve(response({ data: [{ id: 'middle' }], total: 2 }))
      await flush()
    })
    expect(mocks.workflowDetailsProps.details).toBeUndefined()
    expect(mocks.workflowDetailsProps.isLoadingMore).toBe(false)

    await act(async () => {
      pending[2].resolve(response({ data: [{ id: 'fresh' }], total: 2 }))
      await flush()
    })
    expect(mocks.workflowDetailsProps.details.logs[0].id).toBe('fresh')
    expect(mocks.workflowDetailsProps.hasMore).toBe(true)
  })

  it('announces workflow detail loading and exposes safe retry states', async () => {
    const { deriveWorkflowDetailsView, resolveWorkflowDetailLifecycle } = await import(
      './components/stats/stats'
    )
    const lifecycle = resolveWorkflowDetailLifecycle
    const failed = lifecycle(['two'], {}, { two: 'details' }, 'new')
    expect(failed).toEqual({ failedIds: ['two'], ready: false })
    expect(
      ['old', 'new'].map(
        (key) => lifecycle(['one'], { one: { __meta: { key } } } as any, {}, 'new').ready
      )
    ).toEqual([false, true])

    const details = Object.freeze({
      errorRates: [],
      durations: [],
      executionCounts: [],
      logs: [],
      allLogs: [],
    })
    const segments = [
      { timestamp: 'one', totalExecutions: 2, successfulExecutions: 1 },
      { timestamp: 'two', totalExecutions: 3, successfulExecutions: 3 },
    ] as any
    expect([
      ...[[0], []].map(
        (indices) =>
          deriveWorkflowDetailsView(details, segments, indices, []).executionCounts.length
      ),
      '__filtered' in details,
    ]).toEqual([1, 2, false])

    const onRetry = vi.fn()
    const status = () => container.querySelector('[role="status"]')
    const alert = () => container.querySelector('[role="alert"]')
    await renderWorkflowDetails({ onRetry })

    expect(status()).toHaveTextContent('Loading execution history...')
    expect(status()?.parentElement).toHaveAttribute('aria-busy', 'true')

    await renderWorkflowDetails({ failureMode: 'details', onRetry })
    expect(alert()).toHaveTextContent('Failed to fetch execution history.')
    expect(status()?.parentElement).not.toHaveAttribute('aria-busy')

    await act(async () => {
      alert()
        ?.querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRetry).toHaveBeenCalledTimes(1)

    await renderWorkflowDetails({ details, onRetry })
    expect(status()).toHaveTextContent('0 execution records loaded.')
    expect(status()?.parentElement).not.toHaveAttribute('aria-busy')

    await renderWorkflowDetails({ details, isLoadingMore: true, onRetry })
    expect(status()).toHaveTextContent('Loading more...')
    expect(status()?.parentElement).toHaveAttribute('aria-busy', 'true')

    await renderWorkflowDetails({ details, failureMode: 'more', onRetry })
    expect(alert()).toHaveTextContent('More execution records could not be loaded.')
    expect(container.querySelector('[data-testid="workflow-line-chart"]')).toBeTruthy()
  })

  it('defaults to the Orders tab when the URL has no tab parameter', async () => {
    await renderRecords()

    expect(container.querySelector('[data-testid="orders-table"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="logs-list"]')).toBeFalsy()
    expect(window.location.search).toBe('')
  })

  it('hydrates the Logs tab from the URL', async () => {
    window.history.pushState({}, '', '/workspace/workspace-1/records?tab=logs')

    await renderRecords()

    expect(container.querySelector('[data-testid="logs-list"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="orders-table"]')).toBeFalsy()
    expect(window.location.search).toBe('?tab=logs')
  })

  it('renders Stats controls in the Records toolbar', async () => {
    window.history.pushState({}, '', '/workspace/workspace-1/records?tab=stats')

    await renderRecords()

    const statsView = container.querySelector('[data-testid="stats-view"]')
    const searchInput = container.querySelector(
      'input[placeholder="Search workflows..."]'
    ) as HTMLInputElement | null
    const findButton = (label: string) =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(label)
      )

    expect([statsView, searchInput, findButton('Filters')].every(Boolean)).toBe(true)

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(searchInput, 'orders')
    await act(async () => {
      searchInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="stats-view"]')).toHaveAttribute(
      'data-search-query',
      'orders'
    )

    const liveButton = findButton('Live')
    expect(liveButton).toBeTruthy()

    await act(async () => {
      liveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="stats-view"]')).toHaveAttribute(
      'data-live',
      'true'
    )

    const refreshButton = findButton('Refresh')
    expect(refreshButton).toBeTruthy()

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="stats-view"]')).toHaveAttribute(
      'data-refresh-request',
      '1'
    )
  })

  it('preserves the selected order while URL filter state changes through history navigation', async () => {
    await renderRecords()

    const orderButton = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'order-1'
    )
    if (!(orderButton instanceof HTMLButtonElement)) {
      throw new Error('Expected order row button to render')
    }

    await act(async () => {
      orderButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    expect(container.querySelector('[data-testid="order-details"]')?.textContent).toContain(
      'order-1:order'
    )

    await act(async () => {
      window.history.pushState({}, '', '/workspace/workspace-1/records?side=buy')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await flush()
    })

    expect(
      container.querySelector('[data-testid="order-filter-menu"]')?.getAttribute('data-side')
    ).toBe('buy')
    expect(container.querySelector('[data-testid="order-details"]')?.textContent).toContain(
      'order-1:order'
    )
  })
})
