/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockGetWatchlist = vi.fn()

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

vi.mock('@/lib/watchlists/operations', () => {
  class WatchlistOperationError extends Error {
    status: number

    constructor(message: string, status = 400) {
      super(message)
      this.name = 'WatchlistOperationError'
      this.status = status
    }
  }

  return {
    WatchlistOperationError,
    getWatchlist: mockGetWatchlist,
  }
})

describe('Watchlist export API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWatchlist.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'My Watchlist',
      isSystem: false,
      items: [
        {
          id: 'one',
          type: 'listing',
          listing: {
            listing_id: 'aapl-id',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
        {
          id: 'section-1',
          type: 'section',
          label: 'Tech',
        },
        {
          id: 'two',
          type: 'listing',
          listing: {
            listing_id: '',
            base_id: 'BTC',
            quote_id: 'USDT',
            listing_type: 'crypto',
          },
        },
      ],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  it('exports a unified watchlist JSON file', async () => {
    const { GET } = await import('@/app/api/watchlists/[watchlistId]/export/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists/watchlist-1/export?workspaceId=workspace-1'),
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('my_watchlist.json')
    expect(JSON.parse(body)).toEqual({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'watchlistWidget',
      resourceTypes: ['watchlists'],
      skills: [],
      workflows: [],
      watchlists: [
        {
          name: 'My Watchlist',
          items: [
            {
              type: 'listing',
              listing: {
                listing_id: 'aapl-id',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
              },
            },
            {
              type: 'section',
              label: 'Tech',
              items: [
                {
                  type: 'listing',
                  listing: {
                    listing_id: '',
                    base_id: 'BTC',
                    quote_id: 'USDT',
                    listing_type: 'crypto',
                  },
                },
              ],
            },
          ],
        },
      ],
      customTools: [],
      indicators: [],
    })
  })

  it('returns 400 when workspaceId is missing', async () => {
    const { GET } = await import('@/app/api/watchlists/[watchlistId]/export/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists/watchlist-1/export'),
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('workspaceId is required')
  })
})
