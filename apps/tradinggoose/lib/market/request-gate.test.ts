/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchMock,
  mockReadServerJsonCache,
  mockResolveMarketApiServiceConfig,
  mockWriteServerJsonCache,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mockReadServerJsonCache: vi.fn(),
  mockResolveMarketApiServiceConfig: vi.fn(),
  mockWriteServerJsonCache: vi.fn(),
}))

vi.mock('@/lib/cache/server-json-cache', () => ({
  readServerJsonCache: (...args: unknown[]) => mockReadServerJsonCache(...args),
  writeServerJsonCache: (...args: unknown[]) => mockWriteServerJsonCache(...args),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveMarketApiServiceConfig: (...args: unknown[]) => mockResolveMarketApiServiceConfig(...args),
}))

describe('TradingGoose Market request gate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockResolveMarketApiServiceConfig.mockResolvedValue({
      apiKey: 'market-secret',
      baseUrl: 'https://market.example.com',
    })
  })

  it('returns cached search responses before fetching upstream', async () => {
    mockReadServerJsonCache.mockResolvedValue({
      body: '{"data":[]}',
      headers: [['content-type', 'application/json']],
      status: 200,
    })

    const { requestTradingGooseMarket } = await import('./request-gate')
    const response = await requestTradingGooseMarket('/api/search?version=v1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockWriteServerJsonCache).not.toHaveBeenCalled()
  })

  it('uses a global cache key independent of caller headers and query param order', async () => {
    mockReadServerJsonCache.mockResolvedValue(null)
    fetchMock.mockImplementation(
      () =>
        new Response('{"data":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )

    const { requestTradingGooseMarket } = await import('./request-gate')
    await requestTradingGooseMarket('/api/search?b=2&a=1', {
      headers: { 'x-user-id': 'user-1' },
    })
    await requestTradingGooseMarket('/api/search?a=1&b=2', {
      headers: { 'x-user-id': 'user-2' },
    })

    expect(mockReadServerJsonCache.mock.calls[0]?.[0]).toBe(
      mockReadServerJsonCache.mock.calls[1]?.[0]
    )
    expect(mockWriteServerJsonCache.mock.calls[0]?.[0]).toBe(
      mockWriteServerJsonCache.mock.calls[1]?.[0]
    )
  })

  it('deduplicates concurrent identical get misses in the current process', async () => {
    mockReadServerJsonCache.mockResolvedValue(null)
    let resolveFetch: (value: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )

    const { requestTradingGooseMarket } = await import('./request-gate')
    const first = requestTradingGooseMarket('/api/get/listing?id=AAPL')
    const second = requestTradingGooseMarket('/api/get/listing?id=AAPL')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(
      new Response('{"data":{"id":"AAPL"}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const [firstResponse, secondResponse] = await Promise.all([first, second])
    expect(await firstResponse.json()).toEqual({ data: { id: 'AAPL' } })
    expect(await secondResponse.json()).toEqual({ data: { id: 'AAPL' } })
    expect(mockWriteServerJsonCache).toHaveBeenCalledTimes(1)
  })

  it('does not read or write cache for update requests', async () => {
    mockReadServerJsonCache.mockResolvedValue({
      body: '{"cached":true}',
      headers: [['content-type', 'application/json']],
      status: 200,
    })
    fetchMock.mockResolvedValue(
      new Response('{"fresh":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const { requestTradingGooseMarket } = await import('./request-gate')
    const response = await requestTradingGooseMarket('/api/update/listing-rank', {
      body: '{"listing_id":"AAPL"}',
      method: 'POST',
    })

    expect(mockReadServerJsonCache).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ fresh: true })
    expect(mockWriteServerJsonCache).not.toHaveBeenCalled()
  })

  it('does not cache validate-key requests', async () => {
    mockReadServerJsonCache.mockResolvedValue({
      body: '{"cached":true}',
      headers: [['content-type', 'application/json']],
      status: 200,
    })
    fetchMock.mockResolvedValue(
      new Response('{"fresh":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const { requestTradingGooseMarket } = await import('./request-gate')
    const response = await requestTradingGooseMarket('/api/validate-key/get-api-keys', {
      body: '{"userId":"user-1"}',
      method: 'POST',
    })

    expect(mockReadServerJsonCache).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ fresh: true })
    expect(mockWriteServerJsonCache).not.toHaveBeenCalled()
  })

  it('injects the central TradingGoose-Market service credential', async () => {
    mockReadServerJsonCache.mockResolvedValue(null)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const { requestTradingGooseMarket } = await import('./request-gate')
    await requestTradingGooseMarket('/api/search?version=v1', {
      headers: { 'x-api-key': 'caller-key' },
    })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('x-api-key')).toBe('market-secret')
  })
})
