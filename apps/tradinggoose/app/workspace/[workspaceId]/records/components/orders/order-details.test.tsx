/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { OrderDetails } from './order-details'

const mockUseResolvedListings = vi.fn()
const mockUseProviderOrderDetail = vi.fn()
const mockProviderRefetch = vi.fn()

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/records/components/log-details/log-details', () => ({
  LogDetails: ({ headerControls, log }: any) => (
    <div>
      log details {log?.id}
      {headerControls}
    </div>
  ),
}))

vi.mock('@/hooks/queries/listing-resolution', () => ({
  useResolvedListings: (...args: unknown[]) => mockUseResolvedListings(...args),
}))

vi.mock('@/hooks/queries/records-orders', () => ({
  useProviderOrderDetail: (...args: unknown[]) => mockUseProviderOrderDetail(...args),
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

describe('OrderDetails', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockUseResolvedListings.mockReturnValue({ data: {} })
    mockUseProviderOrderDetail.mockReturnValue({
      data: null,
      error: null,
      isFetching: false,
      refetch: mockProviderRefetch,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mockUseResolvedListings.mockReset()
    mockUseProviderOrderDetail.mockReset()
    mockProviderRefetch.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders normalized order data and refreshes provider details from the header control', async () => {
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
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('Apple Inc.')
    expect(container.textContent).toContain('STOCK')
    expect(container.textContent).not.toContain('DEFAULT')
    expect(container.textContent).not.toContain('Resolving listing')
    expect(container.textContent).not.toContain('App order id')
    expect(container.textContent).not.toContain('Client order id')
    expect(container.textContent).not.toContain('client-order-1')
    expect(container.textContent).toContain('Order type')
    expect(container.textContent).toContain('Limit')
    expect(container.textContent).toContain('Time in force')
    expect(container.textContent).toContain('DAY')
    expect(container.textContent).toContain('Execution')
    expect(container.textContent).toContain('Execution price')
    expect(container.textContent).toContain('Provider order id')
    expect(container.textContent).toContain('Timeline')
    expect(container.textContent).toContain('Workflow')
    expect(container.textContent).not.toContain('listingIdentity')
    expect(container.textContent).not.toContain('normalizedOrder')
    expect(mockUseResolvedListings).toHaveBeenCalledWith({
      listings: [listingIdentity],
      enabled: true,
    })
    expect(mockUseProviderOrderDetail).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      orderId: 'order-1',
      enabled: false,
    })

    const providerButton = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Refresh provider order detail'
    )
    if (!(providerButton instanceof HTMLButtonElement)) {
      throw new Error('Expected provider refresh button to render')
    }

    await act(async () => {
      providerButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onModeChange).toHaveBeenCalledWith('order')
    expect(mockProviderRefetch).toHaveBeenCalled()
  })

  it('keeps order data access visible when log mode loads a linked log', async () => {
    await act(async () => {
      root.render(
        <OrderDetails
          workspaceId='workspace-1'
          order={order}
          detail={null}
          detailsLoading={false}
          detailsError={null}
          linkedLog={{ id: 'log-1' } as any}
          linkedLogLoading={false}
          linkedLogError={null}
          mode='log'
          onModeChange={vi.fn()}
          onClose={vi.fn()}
          onRetryDetails={vi.fn()}
          onRetryLog={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('log details log-1')
    expect(container.textContent).toContain('Order data')
  })

  it('renders provider refresh differences inside the order data card', async () => {
    mockUseProviderOrderDetail.mockReturnValue({
      data: {
        data: {
          orderDetail: {
            averageFillPrice: '185.10',
            filledAt: '2026-04-23T00:03:00.000Z',
            filledQuantity: '4',
            remainingQuantity: '1',
            status: 'partially_filled',
            updatedAt: '2026-04-23T00:03:00.000Z',
          },
        },
      },
      error: null,
      isFetching: false,
      refetch: mockProviderRefetch,
    })

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
          onModeChange={vi.fn()}
          onClose={vi.fn()}
          onRetryDetails={vi.fn()}
          onRetryLog={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('latest')
    expect(container.textContent).toContain('Partially Filled')
    expect(container.textContent).toContain('$185.10')
    expect(container.textContent).not.toContain('raw')
  })

  it('does not synthesize execution price or fee for an unfilled order', async () => {
    await act(async () => {
      root.render(
        <OrderDetails
          workspaceId='workspace-1'
          order={{
            ...order,
            averageFillPrice: null,
            fee: null,
            filledAt: null,
            filledQuantity: '0',
            message: null,
            remainingQuantity: '5',
            status: 'accepted',
            submittedPrice: null,
          }}
          detail={null}
          detailsLoading={false}
          detailsError={null}
          linkedLog={null}
          linkedLogLoading={false}
          linkedLogError={null}
          mode='order'
          onModeChange={vi.fn()}
          onClose={vi.fn()}
          onRetryDetails={vi.fn()}
          onRetryLog={vi.fn()}
        />
      )
    })

    expect(container.textContent).toMatch(/Execution price\s*—/)
    expect(container.textContent).toMatch(/Fee\s*—/)
    expect(container.textContent).not.toContain('$184.25')
  })
})
