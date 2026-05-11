/**
 * @vitest-environment jsdom
 */

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { OrdersTable } from './orders-table'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
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
  logId: 'log-1',
  workspaceId: 'workspace-1',
}

describe('OrdersTable', () => {
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

  it('renders order columns and opens the selected row', async () => {
    const onOrderClick = vi.fn()
    const onSortChange = vi.fn()

    await act(async () => {
      root.render(
        <OrdersTable
          orders={[order]}
          total={1}
          selectedOrderId='order-1'
          loading={false}
          error={null}
          hasMore={false}
          isFetchingMore={false}
          sortBy='recordedAt'
          sortOrder='desc'
          onSortChange={onSortChange}
          onOrderClick={onOrderClick}
          onOpenOrder={vi.fn()}
          onOpenLog={vi.fn()}
          onOpenProvider={vi.fn()}
          loaderRef={createRef<HTMLDivElement>()}
          scrollContainerRef={createRef<HTMLDivElement>()}
          selectedRowRef={createRef<HTMLTableRowElement>()}
        />
      )
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Workflow')
    expect(container.textContent).toContain('Limit')
    expect(container.textContent).toContain('DAY')
    expect(container.querySelector('.selected-row')).toBeTruthy()

    const row = Array.from(container.querySelectorAll('tr')).find((node) =>
      node.textContent?.includes('provider-order-1')
    )
    if (!(row instanceof HTMLTableRowElement)) {
      throw new Error('Expected order row to render')
    }

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOrderClick).toHaveBeenCalledWith(order)
  })
})
