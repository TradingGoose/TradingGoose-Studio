/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockAppendListingsToWatchlist = vi.fn()

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

vi.mock('@/lib/watchlists/operations', async () => {
  const actual = await vi.importActual<any>('@/lib/watchlists/operations')
  return {
    ...actual,
    appendListingsToWatchlist: mockAppendListingsToWatchlist,
  }
})

describe('Watchlist import API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockAppendListingsToWatchlist.mockResolvedValue({
      watchlist: {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Default',
        isSystem: true,
        items: [],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      addedCount: 1,
      skippedCount: 0,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('AAPL')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  listing_id: 'aapl-id',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        }

        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('imports symbols and reports unresolved entries', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      content: 'NASDAQ:AAPL,UNKNOWN:ZZZ',
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.import.addedCount).toBe(1)
    expect(payload.import.unresolvedSymbols).toContain('UNKNOWN:ZZZ')
    expect(mockAppendListingsToWatchlist).toHaveBeenCalled()
  })
})
