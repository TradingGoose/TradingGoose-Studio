/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useMarketQuoteSnapshots,
  type MarketQuoteSnapshot,
} from '@/hooks/queries/market-quote-snapshots'

const { socketMock } = vi.hoisted(() => ({
  socketMock: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    handlers: new Map<string, Set<(payload?: any) => void>>(),
  },
}))

vi.mock('@/contexts/socket-context', () => ({
  useSocket: () => ({
    socket: socketMock,
    isConnected: true,
    isConnecting: false,
  }),
}))

const listing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

const quoteSnapshot: MarketQuoteSnapshot = {
  lastPrice: 101,
  previousClose: 100,
  change: 1,
  changePercent: 1,
}

const triggerSocketEvent = (event: string, payload?: any) => {
  socketMock.handlers.get(event)?.forEach((handler) => handler(payload))
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

const Harness = ({
  onUpdate,
}: {
  onUpdate: (data: ReturnType<typeof useMarketQuoteSnapshots>) => void
}) => {
  const result = useMarketQuoteSnapshots({
    workspaceId: 'workspace-1',
    provider: 'alpaca',
    items: [
      { key: 'row-1', listing },
      { key: 'row-2', listing },
    ],
  })

  onUpdate(result)
  return null
}

describe('useMarketQuoteSnapshots', () => {
  let container: HTMLDivElement
  let root: Root
  let unmounted: boolean

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    socketMock.emit.mockReset()
    socketMock.on.mockReset()
    socketMock.off.mockReset()
    socketMock.handlers.clear()
    socketMock.on.mockImplementation((event: string, handler: (payload?: any) => void) => {
      const handlers = socketMock.handlers.get(event) ?? new Set()
      handlers.add(handler)
      socketMock.handlers.set(event, handlers)
      return socketMock
    })
    socketMock.off.mockImplementation((event: string, handler: (payload?: any) => void) => {
      socketMock.handlers.get(event)?.delete(handler)
      return socketMock
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    unmounted = false
  })

  afterEach(() => {
    if (!unmounted) {
      act(() => {
        root.unmount()
      })
    }
    container.remove()
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('subscribes once per canonical listing and maps snapshots back to widget aliases', async () => {
    const updates: Array<ReturnType<typeof useMarketQuoteSnapshots>> = []

    await act(async () => {
      root.render(<Harness onUpdate={(result) => updates.push(result)} />)
    })

    const subscribeCalls = socketMock.emit.mock.calls.filter(
      ([event]) => event === 'market-subscribe'
    )
    expect(subscribeCalls).toHaveLength(1)
    expect(subscribeCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        provider: 'alpaca',
        workspaceId: 'workspace-1',
        listing,
        channel: 'quote-snapshots',
      })
    )

    const clientSubscriptionId = subscribeCalls[0]?.[1]?.clientSubscriptionId
    await act(async () => {
      triggerSocketEvent('market-quote-snapshot', {
        provider: 'alpaca',
        channel: 'quote-snapshots',
        clientSubscriptionId,
        listing,
        snapshot: quoteSnapshot,
      })
    })

    const latest = updates[updates.length - 1]
    expect(latest?.data).toEqual({
      'row-1': quoteSnapshot,
      'row-2': quoteSnapshot,
    })
    expect(latest?.isLoading).toBe(false)
  })

  it('uses server subscription ids for cleanup after subscribe ack', async () => {
    await act(async () => {
      root.render(<Harness onUpdate={() => undefined} />)
    })

    const subscribePayload = socketMock.emit.mock.calls.find(
      ([event]) => event === 'market-subscribe'
    )?.[1]
    expect(subscribePayload?.clientSubscriptionId).toBeTruthy()

    await act(async () => {
      triggerSocketEvent('market-subscribed', {
        provider: 'alpaca',
        channel: 'quote-snapshots',
        subscriptionId: 'server-subscription-1',
        clientSubscriptionId: subscribePayload.clientSubscriptionId,
      })
    })

    socketMock.emit.mockClear()
    await act(async () => {
      root.unmount()
    })
    unmounted = true

    expect(socketMock.emit).toHaveBeenCalledWith('market-unsubscribe', {
      subscriptionId: 'server-subscription-1',
    })
    expect(socketMock.emit).not.toHaveBeenCalledWith(
      'market-unsubscribe',
      expect.objectContaining({
        clientSubscriptionId: subscribePayload.clientSubscriptionId,
      })
    )
  })
})
