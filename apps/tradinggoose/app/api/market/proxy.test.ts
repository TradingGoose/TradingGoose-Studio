/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockReadServerJsonCache,
  mockWriteServerJsonCache,
  mockResolveMarketApiServiceConfig,
  mockLogger,
  fetchMock,
} = vi.hoisted(() => ({
  mockReadServerJsonCache: vi.fn(),
  mockWriteServerJsonCache: vi.fn(),
  mockResolveMarketApiServiceConfig: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/cache/server-json-cache', () => ({
  readServerJsonCache: (...args: unknown[]) => mockReadServerJsonCache(...args),
  writeServerJsonCache: (...args: unknown[]) => mockWriteServerJsonCache(...args),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveMarketApiServiceConfig: (...args: unknown[]) => mockResolveMarketApiServiceConfig(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

describe('market proxy search cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockResolveMarketApiServiceConfig.mockResolvedValue({
      baseUrl: 'https://market.example.com',
      apiKey: 'market-secret',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('returns cached search responses before hitting the market service', async () => {
    mockReadServerJsonCache.mockResolvedValue({
      body: '{"data":[{"listing_id":"AAPL"}]}',
      status: 200,
      contentType: 'application/json',
    })

    const { proxyMarketRequest } = await import('./proxy')
    const response = await proxyMarketRequest(
      new NextRequest('http://localhost/api/market/search?search_query=AAPL&version=v1'),
      ['search']
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [{ listing_id: 'AAPL' }],
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockWriteServerJsonCache).not.toHaveBeenCalled()
  })

  it('uses a global cache key that does not vary by caller headers', async () => {
    mockReadServerJsonCache.mockResolvedValue({
      body: '{"data":[]}',
      status: 200,
      contentType: 'application/json',
    })

    const { proxyMarketRequest } = await import('./proxy')

    await proxyMarketRequest(
      new NextRequest('http://localhost/api/market/search?search_query=AAPL&version=v1', {
        headers: {
          'x-user-id': 'user-1',
          'x-workspace-id': 'workspace-1',
        },
      }),
      ['search']
    )

    await proxyMarketRequest(
      new NextRequest('http://localhost/api/market/search?search_query=AAPL&version=v1', {
        headers: {
          'x-user-id': 'user-2',
          'x-workspace-id': 'workspace-2',
        },
      }),
      ['search']
    )

    expect(mockReadServerJsonCache).toHaveBeenCalledTimes(2)
    expect(mockReadServerJsonCache.mock.calls[0]?.[0]).toBe(
      mockReadServerJsonCache.mock.calls[1]?.[0]
    )
  })

  it('stores successful search responses in the shared server JSON cache', async () => {
    mockReadServerJsonCache.mockResolvedValue(null)
    fetchMock.mockResolvedValue(
      new Response('{"data":[]}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
      })
    )

    const { proxyMarketRequest } = await import('./proxy')
    const response = await proxyMarketRequest(
      new NextRequest('http://localhost/api/market/search?search_query=AAPL&version=v1'),
      ['search']
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://market.example.com/api/search?search_query=AAPL&version=v1',
      expect.objectContaining({
        method: 'GET',
      })
    )
    expect(mockWriteServerJsonCache).toHaveBeenCalledTimes(1)
    expect(mockWriteServerJsonCache.mock.calls[0]?.[1]).toEqual({
      body: '{"data":[]}',
      status: 200,
      contentType: 'application/json',
    })
    expect(mockWriteServerJsonCache.mock.calls[0]?.[2]).toBe(300)
  })
})
