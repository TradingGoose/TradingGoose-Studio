/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairColor } from '@/widgets/pair-colors'
import { WatchlistWidgetBody } from '@/widgets/widgets/watchlist/components/watchlist-body'

const { socket } = vi.hoisted(() => ({
  socket: {
    connected: true,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    handlers: new Map<string, Set<(payload?: any) => void>>(),
  },
}))

vi.mock('@/contexts/socket-context', () => ({
  useSocket: () => ({ socket, isConnected: true, isConnecting: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true, isLoading: false }),
}))
vi.mock('@/components/listing-selector/selector/input', () => ({ ListingSearchInput: () => null }))

const apple = { listing_id: 'us-aapl', base_id: '', quote_id: '', listing_type: 'default' as const }
const microsoft = { ...apple, listing_id: 'us-msft' }
const watchlist = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  name: 'Stocks',
  items: [
    { id: 'row-apple', type: 'listing' as const, parentId: null, listing: apple },
    { id: 'row-microsoft', type: 'listing' as const, parentId: null, listing: microsoft },
  ],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
}
vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useSelectedWatchlistYjsDocument: () => ({
    record: watchlist,
    items: watchlist.items,
    updateItems: vi.fn(),
    isLoading: false,
    error: null,
    canMutateDocument: true,
    members: [{ entityId: watchlist.id, entityName: watchlist.name }],
  }),
}))
vi.mock('@/hooks/queries/listing-resolution', () => ({
  useResolvedListings: () => ({ data: {} }),
}))

const providers = ['alpaca', 'finnhub', 'alpha-vantage', 'yahoo-finance', 'robinhood']
const configuration = {
  auth: { apiKey: 'test-api-key', apiSecret: 'test-api-secret' },
  providerParams: { feed: 'iex', credentialId: 'test-connection' },
}
const snapshot = { lastPrice: 110, previousClose: 105, change: 5, changePercent: (5 / 105) * 100 }
const widget = (provider: string, pairColor: PairColor = 'gray', configured = true) => (
  <WatchlistWidgetBody
    channelId={`watchlist-${pairColor}`}
    context={{ workspaceId: 'workspace-1' }}
    panelId={`panel-${pairColor}`}
    pairColor={pairColor}
    widget={{ key: 'watchlist', pairColor } as any}
    params={{ provider, ...(configured ? configuration : {}) }}
  />
)
const trigger = (event: string, payload: unknown) =>
  socket.handlers.get(event)?.forEach((handler) => handler(payload))
const subscriptions = () =>
  socket.emit.mock.calls
    .filter(([event]) => event === 'market-subscribe')
    .map(([, payload]) => payload)
const findRow = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes(name))!
const values = (row: Element) =>
  Array.from(row.querySelectorAll('td'))
    .slice(2, 5)
    .map((cell) => cell.querySelector('span')?.textContent)

describe('watchlist quote subscription to rendered rows', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    socket.handlers.clear()
    socket.on.mockImplementation((event: string, handler: (payload?: any) => void) => {
      const handlers = socket.handlers.get(event) ?? new Set()
      handlers.add(handler)
      socket.handlers.set(event, handlers)
      return socket
    })
    socket.off.mockImplementation((event: string, handler: (payload?: any) => void) => {
      socket.handlers.get(event)?.delete(handler)
      return socket
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each(providers)('%s maps snapshots to rows and displays daily values', async (provider) => {
    await act(async () => root.render(widget(provider)))
    expect(findRow(container, apple.listing_id).textContent).toContain('Loading quotes')
    const requests = subscriptions()
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.provider === provider)).toBe(true)
    const aapl = requests.find((request) => request.listing.listing_id === apple.listing_id)
    const msft = requests.find((request) => request.listing.listing_id === microsoft.listing_id)
    await act(async () => {
      trigger('market-quote-snapshot', {
        ...msft,
        snapshot: { lastPrice: 220, previousClose: 200, change: 20, changePercent: 10 },
      })
      trigger('market-quote-snapshot', { ...aapl, snapshot })
    })
    expect(values(findRow(container, apple.listing_id))).toEqual(['110.00', '5.00', '4.76%'])
    expect(values(findRow(container, microsoft.listing_id))).toEqual(['220.00', '20.00', '10.00%'])
    expect(container.textContent).not.toContain('Loading quotes')
  })

  it('keeps available prices visible with their own row errors and clears errors on recovery', async () => {
    await act(async () => root.render(widget('alpaca')))
    const requests = subscriptions()
    const aapl = requests.find((request) => request.listing.listing_id === apple.listing_id)
    const msft = requests.find((request) => request.listing.listing_id === microsoft.listing_id)
    await act(async () => {
      trigger('market-quote-snapshot', {
        ...aapl,
        snapshot: {
          lastPrice: 123.45,
          previousClose: null,
          change: null,
          changePercent: null,
          error: 'Apple snapshot failed',
        },
      })
      trigger('market-subscribe-error', { ...msft, message: 'Microsoft subscription failed' })
    })
    const appleRow = findRow(container, apple.listing_id)
    const microsoftRow = findRow(container, microsoft.listing_id)
    expect(values(appleRow)).toEqual(['123.45', '-', '-'])
    expect(values(microsoftRow)).toEqual(['-', '-', '-'])
    expect(appleRow.querySelector('[role="alert"]')?.textContent).toBe('Apple snapshot failed')
    expect(appleRow.textContent).not.toContain('Microsoft subscription failed')
    expect(microsoftRow.querySelector('[role="alert"]')?.textContent).toBe(
      'Microsoft subscription failed'
    )
    expect(microsoftRow.textContent).not.toContain('Apple snapshot failed')
    await act(async () => {
      trigger('market-quote-snapshot', { ...aapl, snapshot })
      trigger('market-error', { ...aapl, message: 'Apple stream failed' })
    })
    expect(values(appleRow)).toEqual(['110.00', '5.00', '4.76%'])
    expect(appleRow.querySelector('[role="alert"]')?.textContent).toBe('Apple stream failed')
    await act(async () => {
      for (const request of subscriptions())
        trigger('market-quote-snapshot', { ...request, snapshot })
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps differently paired widgets isolated when only one has provider credentials', async () => {
    const renderWidgets = (configureBlue = false) => (
      <>
        <div data-widget='red'>{widget('alpaca', 'red')}</div>
        <div data-widget='blue'>{widget('alpaca', 'blue', configureBlue)}</div>
      </>
    )
    await act(async () => root.render(renderWidgets()))
    const red = container.querySelector<HTMLElement>('[data-widget="red"]')!
    const blue = container.querySelector<HTMLElement>('[data-widget="blue"]')!
    const redRequests = subscriptions()
    expect(redRequests).toHaveLength(2)
    await act(async () => {
      for (const request of redRequests) trigger('market-quote-snapshot', { ...request, snapshot })
    })
    expect(values(findRow(red, apple.listing_id))).toEqual(['110.00', '5.00', '4.76%'])
    expect(values(findRow(blue, apple.listing_id))).toEqual(['-', '-', '-'])
    expect(findRow(blue, apple.listing_id).querySelector('[role="alert"]')?.textContent).toContain(
      'API Key'
    )
    socket.emit.mockClear()
    await act(async () => root.render(renderWidgets(true)))
    expect(subscriptions()).toHaveLength(2)
    await act(async () => {
      trigger('market-quote-snapshot', { ...redRequests[0], snapshot })
    })
    expect(values(findRow(blue, apple.listing_id))).toEqual(['-', '-', '-'])
    await act(async () => {
      for (const request of subscriptions())
        trigger('market-quote-snapshot', { ...request, snapshot })
    })
    expect(values(findRow(blue, apple.listing_id))).toEqual(['110.00', '5.00', '4.76%'])
  })
})
