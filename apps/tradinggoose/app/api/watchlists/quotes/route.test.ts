/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockExecuteProviderRequest = vi.fn()

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

describe('Watchlist quotes API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('@/app/api/watchlists/quotes/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [
        {
          itemId: 'item-1',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('computes last price, change, and change percent from provider series data', async () => {
    mockExecuteProviderRequest.mockImplementation(async (_providerId: string, request: any) => {
      if (request.interval === '1d') {
        return {
          bars: [
            { timeStamp: '2026-02-17T21:00:00.000Z', close: 100 },
            { timeStamp: '2026-02-18T21:00:00.000Z', close: 105 },
          ],
        }
      }

      if (request.interval === '1m') {
        return {
          bars: [{ timeStamp: '2026-02-19T15:59:00.000Z', close: 110 }],
        }
      }

      return { bars: [] }
    })

    const { POST } = await import('@/app/api/watchlists/quotes/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [
        {
          itemId: 'item-1',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.quotes['item-1']).toEqual({
      lastPrice: 110,
      change: 10,
      changePercent: 10,
      previousClose: 100,
    })
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
    expect(mockExecuteProviderRequest.mock.calls[0]?.[1]?.providerParams?.marketSession).toBe(
      'regular'
    )
    expect(mockExecuteProviderRequest.mock.calls[1]?.[1]?.providerParams?.marketSession).toBe(
      'regular'
    )
  })

  it('falls back to latest daily close when intraday data is empty', async () => {
    mockExecuteProviderRequest.mockImplementation(async (_providerId: string, request: any) => {
      if (request.interval === '1d') {
        return {
          bars: [
            { timeStamp: '2026-02-17T21:00:00.000Z', close: 200 },
            { timeStamp: '2026-02-18T21:00:00.000Z', close: 210 },
          ],
        }
      }

      if (request.interval === '1m') {
        return {
          bars: [],
        }
      }

      return { bars: [] }
    })

    const { POST } = await import('@/app/api/watchlists/quotes/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      provider: 'alpaca',
      items: [
        {
          itemId: 'item-1',
          listing: {
            listing_id: 'MSFT',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.quotes['item-1']).toEqual({
      lastPrice: 210,
      change: 10,
      changePercent: 5,
      previousClose: 200,
    })
  })
})
