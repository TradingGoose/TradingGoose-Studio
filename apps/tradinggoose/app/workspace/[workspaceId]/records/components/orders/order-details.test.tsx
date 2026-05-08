/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { OrderDetails } from './order-details'

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/log-details/log-details', () => ({
  LogDetails: () => <div>log details</div>,
}))

vi.mock('./order-provider-refresh', () => ({
  OrderProviderRefresh: () => <div>provider refresh</div>,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const order: RecordsOrder = {
  accountId: 'account-1',
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

describe('OrderDetails', () => {
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

  it('renders normalized order data and switches detail modes through the header controls', async () => {
    const onModeChange = vi.fn()

    await act(async () => {
      root.render(
        <OrderDetails
          workspaceId='workspace-1'
          order={order}
          detail={null}
          detailsLoading={false}
          detailsError={null}
          linkedLog={null}
          linkedLogLoading={false}
          linkedLogError={null}
          mode='order'
          onModeChange={onModeChange}
          onClose={vi.fn()}
          onRetryDetails={vi.fn()}
          onRetryLog={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('App order id')
    expect(container.textContent).toContain('order-1')
    expect(container.textContent).toContain('Order type')
    expect(container.textContent).toContain('Limit')
    expect(container.textContent).toContain('Time in force')
    expect(container.textContent).toContain('DAY')
    expect(container.textContent).toContain('Log connected')

    const providerButton = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Provider'
    )
    if (!(providerButton instanceof HTMLButtonElement)) {
      throw new Error('Expected provider mode button to render')
    }

    await act(async () => {
      providerButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onModeChange).toHaveBeenCalledWith('provider')
  })
})
