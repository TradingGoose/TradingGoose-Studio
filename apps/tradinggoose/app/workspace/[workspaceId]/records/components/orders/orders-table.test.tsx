/**
 * @vitest-environment jsdom
 */

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { OrdersTable } from './orders-table'

const mockUseResolvedListings = vi.fn()

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
}))

vi.mock('@/hooks/queries/listing-resolution', () => ({
  useResolvedListings: (...args: unknown[]) => mockUseResolvedListings(...args),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const listingIdentity = {
  base_id: '',
  listing_id: 'TG_LSTG_AAPL',
  listing_type: 'default' as const,
  quote_id: '',
}

const order: RecordsOrder = {
  averageFillPrice: '184.25',
  clientOrderId: 'client-order-1',
  environment: 'paper',
  fee: '0',
  fillPrice: null,
  filledAt: '2026-04-23T00:02:00.000Z',
  filledQuantity: '5',
  hasLinkedLog: true,
  id: 'order-1',
  linkedLog: {
    endedAt: null,
    executionId: 'execution-1',
    id: 'log-1',
    level: 'info',
    startedAt: '2026-04-23T00:00:00.000Z',
    workflowName: 'Workflow',
  },
  listing: { listingType: 'stock', name: 'Apple Inc.', symbol: 'AAPL' },
  listingIdentity,
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
  logId: 'log-1',
  workspaceId: 'workspace-1',
}

const orderWithoutProviderDetail: RecordsOrder = {
  ...order,
  id: 'order-2',
  provider: 'tradier',
  providerOrderId: 'provider-order-2',
}

describe('OrdersTable', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockUseResolvedListings.mockReturnValue({ data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mockUseResolvedListings.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders order columns and opens the selected row', async () => {
    const onOrderClick = vi.fn()
    const onSortChange = vi.fn()

    await act(async () => {
      root.render(
        <OrdersTable
          orders={[order, orderWithoutProviderDetail]}
          selectedOrderId='order-1'
          loading={false}
          error={null}
          hasMore={false}
          isFetchingMore={false}
          sortBy='recordedAt'
          sortOrder='desc'
          onSortChange={onSortChange}
          onOrderClick={onOrderClick}
          loaderRef={createRef<HTMLDivElement>()}
          scrollContainerRef={createRef<HTMLDivElement>()}
          selectedRowRef={createRef<HTMLTableRowElement>()}
        />
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Apple Inc.')
    expect(container.textContent).not.toContain('Resolving listing')
    expect(container.textContent).not.toContain('STOCK')
    expect(container.textContent).not.toContain('DEFAULT')
    expect(container.textContent).not.toContain('TG_LSTG_AAPL')
    expect(container.textContent).not.toContain('Order IDs')
    expect(container.textContent).not.toContain('provider-order-1')
    expect(container.textContent).not.toContain('Linked')
    expect(container.textContent).toContain('Recorded at')
    expect(container.textContent).toContain('Updated at')
    expect(container.textContent).toContain('Workflow')
    expect(container.textContent).toContain('Limit')
    expect(container.textContent).toContain('DAY')
    expect(container.querySelector('img[alt="US flag"]')).toBeNull()
    expect(container.querySelector('.selected-row')).toBeTruthy()
    expect(mockUseResolvedListings).toHaveBeenCalledWith({
      listings: [listingIdentity],
      enabled: true,
    })

    const row = container.querySelector('tbody tr')
    if (!(row instanceof HTMLTableRowElement)) {
      throw new Error('Expected order row to render')
    }

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOrderClick).toHaveBeenCalledWith(order)

    onOrderClick.mockClear()
    const providerDetailLinks = Array.from(container.querySelectorAll('a')).filter(
      (node) => node.textContent === 'Open provider order detail'
    )
    expect(providerDetailLinks).toHaveLength(1)
    const [providerDetailLink] = providerDetailLinks
    if (!(providerDetailLink instanceof HTMLAnchorElement)) {
      throw new Error('Expected provider detail link to render')
    }

    expect(providerDetailLink.tagName).toBe('A')
    expect(providerDetailLink.textContent).toBe('Open provider order detail')
    expect(providerDetailLink.getAttribute('role')).toBeNull()
    expect(providerDetailLink.href).toBe(
      'https://app.alpaca.markets/dashboard/order/provider-order-1'
    )
    expect(providerDetailLink.target).toBe('_blank')
    expect(providerDetailLink.rel).toBe('noopener noreferrer')

    const copyButtons = Array.from(container.querySelectorAll('button')).filter(
      (node) => node.textContent === 'Copy order id'
    )
    expect(copyButtons).toHaveLength(2)
    expect(copyButtons.every((button) => button.getAttribute('role') === null)).toBe(true)

    await act(async () => {
      providerDetailLink.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOrderClick).not.toHaveBeenCalled()
  })
})
