/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildLogsRequestParams: vi.fn(() => 'workspaceId=workspace-1'),
  buildOrdersRequestParams: vi.fn(() => 'workspaceId=workspace-1'),
  fetchNextPage: vi.fn(),
  foldersData: [],
  getFolderTree: vi.fn(() => []),
  initializeFromURL: vi.fn(),
  orderDetailRefetch: vi.fn(),
  ordersRefetch: vi.fn(),
  setSearchQuery: vi.fn(),
  setWorkspaceId: vi.fn(),
  useLogDetail: vi.fn(),
  useLogsList: vi.fn(),
  useOrderDetail: vi.fn(),
  useOrdersList: vi.fn(),
}))

const order = {
  accountId: 'account-1',
  averageFillPrice: '184.25',
  clientOrderId: 'client-order-1',
  environment: 'paper',
  fee: '0',
  fillPrice: null,
  filledAt: '2026-04-23T00:02:00.000Z',
  filledQuantity: '5',
  hasLinkedLog: false,
  id: 'order-1',
  linkedLog: null,
  listing: { listingType: 'stock', name: 'Apple Inc.', symbol: 'AAPL' },
  listingIdentity: { listing_id: 'AAPL', listing_type: 'stock' },
  message: 'Filled successfully',
  normalizedOrder: { status: 'filled' },
  notional: null,
  orderType: 'limit',
  provider: 'alpaca',
  providerOrderId: 'provider-order-1',
  quantity: '5',
  recordedAt: '2026-04-23T00:00:00.000Z',
  remainingQuantity: '0',
  request: { side: 'buy' },
  response: { orderId: 'provider-order-1' },
  side: 'buy',
  status: 'filled',
  submissionSource: 'workflow',
  submittedAt: '2026-04-23T00:00:00.000Z',
  submittedPrice: '184.25',
  timeInForce: 'day',
  updatedAt: '2026-04-23T00:02:00.000Z',
  logId: null,
  workspaceId: 'workspace-1',
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizableHandle: () => <div data-testid='resize-handle' />,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/log-details/log-details', () => ({
  LogDetails: ({ log }: any) => <div data-testid='log-details'>{log?.id}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/logs-list', () => ({
  LogsList: () => <div data-testid='logs-list'>logs-list</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/logs-toolbar', () => ({
  AutocompleteSearch: ({ value }: any) => <div data-testid='log-search'>{value}</div>,
  LogsToolbar: ({ center, left, right }: any) => (
    <div data-testid='logs-toolbar'>
      <div>{left}</div>
      <div>{center}</div>
      <div>{right}</div>
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/orders', () => ({
  OrderDetails: ({ mode, order }: any) => (
    <div data-testid='order-details'>
      {order.id}:{mode}
    </div>
  ),
  OrderFilterMenu: ({ state }: any) => (
    <div data-side={state.side} data-testid='order-filter-menu'>
      order-filter-menu
    </div>
  ),
  OrderFilters: ({ searchValue }: any) => (
    <input data-testid='order-search' readOnly value={searchValue} />
  ),
  OrdersTable: ({ onOrderClick, orders, selectedOrderId }: any) => (
    <div data-selected-order-id={selectedOrderId ?? ''} data-testid='orders-table'>
      {orders.map((entry: any) => (
        <button key={entry.id} onClick={() => onOrderClick(entry)} type='button'>
          {entry.id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/stats', () => ({
  Stats: ({ live, refreshRequest, searchQuery }: any) => (
    <div
      data-live={String(live)}
      data-refresh-request={String(refreshRequest)}
      data-search-query={searchQuery}
      data-testid='stats-view'
    >
      stats-view
    </div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/records/components/stats/components/logs-filters/logs-filters',
  () => ({
    LogsFilters: () => <div data-testid='stats-filters'>stats-filters</div>,
  })
)

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
    folderIds: [],
    initializeFromURL: mocks.initializeFromURL,
    level: [],
    searchQuery: '',
    setSearchQuery: mocks.setSearchQuery,
    setWorkspaceId: mocks.setWorkspaceId,
    timeRange: 'all',
    triggers: [],
    workflowIds: [],
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
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
    mocks.useOrderDetail.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      refetch: mocks.orderDetailRefetch,
    })
    mocks.useLogDetail.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.useLogsList.mockReturnValue({
      data: { pages: [{ hasMore: false, logs: [], nextPage: undefined, total: 0 }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    mocks.useOrdersList.mockReturnValue({
      data: { pages: [{ hasMore: false, nextPage: undefined, orders: [order], total: 1 }] },
      error: null,
      fetchNextPage: mocks.fetchNextPage,
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isRefetching: false,
      refetch: mocks.ordersRefetch,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderRecords = async () => {
    const { default: Records } = await import('./records')
    await act(async () => {
      root.render(<Records />)
      await flush()
    })
  }

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
      'input[placeholder="Search workflows"]'
    ) as HTMLInputElement | null

    expect(statsView).toBeTruthy()
    expect(searchInput).toBeTruthy()

    const filterButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Filters')
    )
    expect(filterButton).toBeTruthy()

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(searchInput, 'orders')
    await act(async () => {
      searchInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="stats-view"]')).toHaveAttribute(
      'data-search-query',
      'orders'
    )

    const liveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Live'
    )
    expect(liveButton).toBeTruthy()

    await act(async () => {
      liveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="stats-view"]')).toHaveAttribute(
      'data-live',
      'true'
    )

    const refreshButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Refresh stats')
    )
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
