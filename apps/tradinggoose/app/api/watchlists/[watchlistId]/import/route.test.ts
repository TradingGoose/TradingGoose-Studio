/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockGetWatchlist = vi.fn()
const mockApplySavedEntityState = vi.fn()
class MockSavedEntityPersistenceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'SavedEntityPersistenceError'
  }

  responseBody() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) }
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

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  applySavedEntityState: (...args: unknown[]) => mockApplySavedEntityState(...args),
  SavedEntityPersistenceError: MockSavedEntityPersistenceError,
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
          type: 'section',
          label: 'Tech',
        },
        {
          type: 'listing',
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
      id: 'workspace-1',
      workspaceId: 'workspace-1',
      name: 'Imported Watchlist',
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    mockApplySavedEntityState.mockResolvedValue({
      name: 'Imported Watchlist',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [],
    })
  })

  it('imports one full watchlist document through saved-entity apply', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: importedFile,
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'workspace-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.watchlist.id).toBe('workspace-1')
    expect(mockGetWatchlist).toHaveBeenCalledWith({ workspaceId: 'workspace-1' }, 'workspace-1')
    expect(mockApplySavedEntityState).toHaveBeenCalledWith('watchlist', 'workspace-1', {
      name: 'Imported Watchlist',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [
        {
          type: 'section',
          parentId: null,
          label: 'Tech',
        },
        {
          type: 'listing',
          parentId: null,
          listing: {
            listing_id: 'aapl-id',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })
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
      params: Promise.resolve({ watchlistId: 'workspace-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Invalid watchlist import file')
    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
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
      params: Promise.resolve({ watchlistId: 'workspace-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe('Listing already exists in watchlist')
    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
  })

  it('returns saved-entity persistence validation errors from import apply', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/import/route')
    mockApplySavedEntityState.mockRejectedValueOnce(
      new MockSavedEntityPersistenceError(409, 'Watchlist contains a duplicate name or listing')
    )
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      file: importedFile,
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'workspace-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe('Watchlist contains a duplicate name or listing')
  })
})
