/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type UseMarketQuoteSnapshotsArgs,
  useMarketQuoteSnapshots,
} from '@/hooks/queries/market-quote-snapshots'

const { socket } = vi.hoisted(() => ({
  socket: {
    available: true,
    connected: true,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    handlers: new Map<string, Set<(payload?: any) => void>>(),
  },
}))
vi.mock('@/contexts/socket-context', () => ({
  useSocket: () => ({ socket: socket.available ? socket : null }),
}))

const listing = { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' as const }
const items = [
  { key: 'first', listing },
  { key: 'second', listing },
]
const quote = { lastPrice: 101, previousClose: 100, change: 1, changePercent: 1 }
const request: UseMarketQuoteSnapshotsArgs = {
  workspaceId: 'workspace',
  provider: 'alpaca',
  items,
  auth: { apiKey: 'test-key', apiSecret: 'test-secret' },
  providerParams: { feed: 'iex' },
}
type Result = ReturnType<typeof useMarketQuoteSnapshots>
let latest: Record<string, Result>
const Harness = ({
  id = 'a',
  overrides = {},
}: {
  id?: string
  overrides?: Partial<UseMarketQuoteSnapshotsArgs>
}) => {
  latest[id] = useMarketQuoteSnapshots({ ...request, ...overrides })
  return null
}
const subscriptions = () =>
  socket.emit.mock.calls
    .filter(([event]) => event === 'market-subscribe')
    .map(([, payload]) => payload)
const emit = async (event: string, payload?: unknown) => {
  await act(async () => {
    socket.handlers.get(event)?.forEach((handler) => handler(payload))
  })
}
const receive = (subscription: { clientSubscriptionId: string }, snapshot = quote) =>
  emit('market-quote-snapshot', {
    clientSubscriptionId: subscription.clientSubscriptionId,
    snapshot,
  })

describe('useMarketQuoteSnapshots', () => {
  let root: Root
  let container: HTMLDivElement
  const render = async (overrides: Partial<UseMarketQuoteSnapshotsArgs> = {}) => {
    await act(async () => {
      root.render(<Harness overrides={overrides} />)
    })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    latest = {}
    socket.available = socket.connected = true
    socket.handlers.clear()
    socket.on.mockImplementation((event, handler) => {
      const handlers = socket.handlers.get(event) ?? new Set()
      handlers.add(handler)
      socket.handlers.set(event, handlers)
    })
    socket.off.mockImplementation((event, handler) => {
      socket.handlers.get(event)?.delete(handler)
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('uses each required item key directly, including repeated listings', async () => {
    await render()
    const [first, second] = subscriptions()
    expect(subscriptions()).toHaveLength(2)
    expect(first.clientSubscriptionId).not.toBe(second.clientSubscriptionId)
    await receive(second)
    expect(latest.a.data).toEqual({ second: quote })
    expect(latest.a.isFetching).toBe(true)
    await receive(first)
    expect(latest.a.data).toEqual({ first: quote, second: quote })
    expect(latest.a.isFetching).toBe(false)
  })

  it('isolates configured and unconfigured widgets and accepts only each widget own subscription', async () => {
    const renderWidgets = async (configured: boolean) =>
      act(async () => {
        root.render(
          <>
            <Harness id='a' overrides={{ items: [items[0]] }} />
            <Harness
              id='b'
              overrides={{
                items: [items[0]],
                ...(configured
                  ? { providerParams: { feed: 'sip' } }
                  : { auth: undefined, providerParams: undefined }),
              }}
            />
          </>
        )
      })
    await renderWidgets(false)
    const first = subscriptions()[0]
    expect(subscriptions()).toHaveLength(1)
    await receive(first)
    expect(latest.a.data.first).toEqual(quote)
    expect(latest.b.data).toEqual({})
    expect(latest.b.error?.message).toContain('API Key')
    await renderWidgets(true)
    const second = subscriptions().at(-1)
    await receive(first)
    expect(latest.b.data).toEqual({})
    await receive(second)
    expect(latest.b.data.first).toEqual(quote)
  })

  it('clears prior scope data and ignores late or unowned responses after settings change', async () => {
    await render({ items: [items[0]] })
    const previous = subscriptions()[0]
    await receive(previous)
    await render({ items: [items[0]], providerParams: { feed: 'sip' } })
    expect(latest.a.data).toEqual({})
    await receive(previous)
    await emit('market-error', { ...previous, message: 'Previous subscription failed' })
    await emit('market-quote-snapshot', { listing, snapshot: quote })
    expect(latest.a.data).toEqual({})
    await receive(subscriptions().at(-1))
    expect(latest.a.data.first).toEqual(quote)
  })

  it('gates active requests by required credentials and accepts provider defaults', async () => {
    for (const provider of ['alpaca', 'finnhub', 'alpha-vantage', 'robinhood']) {
      await render({ provider, auth: undefined, providerParams: undefined })
      expect(latest.a.error?.message).toContain('Configure market provider settings:')
    }
    for (const idle of [{ items: [] }, { enabled: false }, { workspaceId: '' }]) {
      await render({ ...idle, auth: undefined, providerParams: undefined })
      expect(latest.a.error).toBeNull()
      expect(latest.a.isFetching).toBe(false)
    }
    expect(subscriptions()).toHaveLength(0)
    await render({ providerParams: undefined })
    expect(latest.a.error).toBeNull()
    expect(subscriptions()).toHaveLength(2)
    await render({ provider: 'yahoo-finance', auth: undefined, providerParams: undefined })
    expect(subscriptions()).toHaveLength(4)
  })

  it('attaches row errors without discarding available quotes and replaces them on recovery', async () => {
    await render()
    const [first, second] = subscriptions()
    await receive(second)
    for (const [event, previous] of [
      ['market-subscribe-error', { lastPrice: null, change: null, changePercent: null }],
      ['market-error', quote],
    ] as const) {
      await emit(event, {
        clientSubscriptionId: first.clientSubscriptionId,
        message: 'Provider unavailable',
      })
      expect(latest.a.data.first).toMatchObject({
        ...previous,
        error: 'Provider unavailable',
      })
      expect(latest.a.data.second).toEqual(quote)
      expect(latest.a.error).toBeNull()
      await receive(first)
      expect(latest.a.data.first).toEqual(quote)
    }
    expect(latest.a.isFetching).toBe(false)
  })

  it('waits for budgeted rows and uses refreshKey to start a clean request', async () => {
    vi.useFakeTimers()
    await render()
    await receive(subscriptions()[0])
    await act(async () => {
      vi.advanceTimersByTime(65_000)
    })
    expect(latest.a.data.first).toEqual(quote)
    expect(latest.a.data.second).toBeUndefined()
    expect(latest.a.error).toBeNull()
    expect(latest.a.isFetching).toBe(true)
    await receive(subscriptions()[1])
    expect(latest.a.data.second).toEqual(quote)
    expect(latest.a.isFetching).toBe(false)
    await render({ refreshKey: 1 })
    expect(latest.a.data).toEqual({})
    expect(latest.a.isLoading).toBe(true)
    for (const subscription of subscriptions().slice(-2)) await receive(subscription)
    expect(latest.a.isFetching).toBe(false)
  })

  it('reports missing and disconnected sockets, then clears transport errors on reconnect', async () => {
    socket.available = false
    await render()
    expect(latest.a.error?.message).toContain('unavailable')
    socket.available = true
    socket.connected = false
    await render()
    expect(latest.a.error?.message).toContain('unavailable')
    expect(subscriptions()).toHaveLength(0)
    socket.connected = true
    await emit('connect')
    await receive(subscriptions()[0])
    for (const event of ['disconnect', 'connect_error']) {
      await emit(event)
      expect(latest.a.error).toBeInstanceOf(Error)
      expect(latest.a.data).toEqual({})
      expect(latest.a.isFetching).toBe(false)
      await emit('connect')
      expect(latest.a.error).toBeNull()
      expect(latest.a.isLoading).toBe(true)
    }
  })

  it('unsubscribes by client ID and removes listeners', async () => {
    await render()
    const requests = subscriptions()
    await act(async () => root.unmount())
    for (const { clientSubscriptionId } of requests) {
      expect(socket.emit).toHaveBeenCalledWith('market-unsubscribe', { clientSubscriptionId })
    }
    expect(Array.from(socket.handlers.values()).every((handlers) => handlers.size === 0)).toBe(true)
  })
})
