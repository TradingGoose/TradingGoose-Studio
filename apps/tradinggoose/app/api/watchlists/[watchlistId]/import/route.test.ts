/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockGetWatchlist = vi.fn()
const mockApplyEntityStateInSocketServer = vi.fn()
class MockSocketServerBridgeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'SocketServerBridgeError'
  }
}

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
    getWatchlist: mockGetWatchlist,
  }
})

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: (...args: unknown[]) =>
    mockApplyEntityStateInSocketServer(...args),
  SocketServerBridgeError: MockSocketServerBridgeError,
}))

const importedFile = {
  version: '1',
  fileType: 'tradingGooseExport',
  exportedAt: '2026-04-06T12:00:00.000Z',
  exportedFrom: 'watchlistWidget',
  resourceTypes: ['watchlists'],
  watchlists: [
    {
      name: 'Imported Watchlist',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'section',
          parentId: null,
          label: 'Tech',
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'listing',
          parentId: '00000000-0000-4000-8000-000000000001',
          listing: {
            listing_id: 'aapl-id',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    },
  ],
}

describe('Watchlist import API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWatchlist.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      name: 'Imported Watchlist',
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    mockApplyEntityStateInSocketServer.mockResolvedValue({
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [],
    })
  })

  it('defers imported row identity ownership to the atomic socket mutation', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: importedFile,
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.watchlist.id).toBe('watchlist-1')
    expect(mockGetWatchlist).toHaveBeenCalledWith({ workspaceId: 'workspace-1' }, 'watchlist-1')
    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledTimes(1)
    const [entityId, entityKind, workspaceId, , fields, options] =
      mockApplyEntityStateInSocketServer.mock.calls[0]!
    expect([entityId, entityKind, workspaceId]).toEqual(['watchlist-1', 'watchlist', 'workspace-1'])
    expect(fields).toMatchObject({
      settings: { showLogo: true, showTicker: true, showDescription: true },
    })
    expect(options).toEqual({ identity: { name: 'Imported Watchlist' } })
    const [section, listing] = fields.items
    expect(section.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(listing.id).toBe('00000000-0000-4000-8000-000000000002')
    expect(listing.parentId).toBe(section.id)
  })

  it('returns 400 when the watchlist document is invalid', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: {
        ...importedFile,
        watchlists: [
          {
            name: 'Imported Watchlist',
            settings: { showLogo: true, showTicker: true, showDescription: true },
            items: [
              {
                type: 'section',
                label: 'Tech',
                items: [],
              },
            ],
          },
        ],
      },
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Invalid watchlist import file')
    expect(mockApplyEntityStateInSocketServer).not.toHaveBeenCalled()
  })

  it('returns a validation error for duplicate imported listing identities', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: {
        ...importedFile,
        watchlists: [
          {
            name: 'Imported Watchlist',
            settings: { showLogo: true, showTicker: true, showDescription: true },
            items: [
              {
                type: 'listing',
                listing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
              {
                type: 'listing',
                listing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
            ],
          },
        ],
      },
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe('Listing already exists in watchlist')
    expect(mockApplyEntityStateInSocketServer).not.toHaveBeenCalled()
  })

  it('returns socket-owned import validation errors', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(
      new MockSocketServerBridgeError(409, 'Watchlist contains a duplicate listing')
    )
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: importedFile,
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe('Watchlist contains a duplicate listing')
    expect(mockGetWatchlist).toHaveBeenCalledTimes(1)
    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'watchlist-1',
      'watchlist',
      'workspace-1',
      'user-1',
      expect.any(Object),
      { identity: { name: 'Imported Watchlist' } }
    )
  })

  it('returns a retryable response when realtime persistence is unavailable', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(
      new MockSocketServerBridgeError(502, 'Socket server unavailable')
    )

    const response = await POST(
      createMockRequest('POST', {
        workspaceId: 'workspace-1',
        file: importedFile,
      }),
      {
        params: Promise.resolve({ watchlistId: 'watchlist-1' }),
      }
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'SAVED_ENTITY_REALTIME_REQUIRED',
      retryable: true,
    })
  })
})
