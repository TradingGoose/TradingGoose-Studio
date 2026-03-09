/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  })

  it('imports listing identity JSON payload', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      listings: [
        {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      ],
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.import.addedCount).toBe(1)
    expect(payload.import.skippedCount).toBe(0)
    expect(mockAppendListingsToWatchlist).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1',
      [
        {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      ]
    )
  })

  it('returns 400 when any listing identity is invalid', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      listings: [
        {
          listing_id: '',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      ],
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Invalid listing identities payload')
    expect(mockAppendListingsToWatchlist).not.toHaveBeenCalled()
  })
})
