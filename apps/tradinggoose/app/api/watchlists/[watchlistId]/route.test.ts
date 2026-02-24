/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockRenameWatchlist = vi.fn()
const mockDeleteWatchlist = vi.fn()
const mockClearWatchlist = vi.fn()
const mockUpdateWatchlistSettings = vi.fn()
const mockReorderWatchlistItems = vi.fn()

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
    renameWatchlist: mockRenameWatchlist,
    deleteWatchlist: mockDeleteWatchlist,
    clearWatchlist: mockClearWatchlist,
    updateWatchlistSettings: mockUpdateWatchlistSettings,
    reorderWatchlistItems: mockReorderWatchlistItems,
  }
})

describe('Watchlist by id API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('renames a watchlist via PATCH', async () => {
    mockRenameWatchlist.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Updated Name',
      isSystem: false,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { PATCH } = await import('@/app/api/watchlists/[watchlistId]/route')
    const request = createMockRequest('PATCH', {
      workspaceId: 'workspace-1',
      action: 'rename',
      name: 'Updated Name',
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.watchlist.name).toBe('Updated Name')
    expect(mockRenameWatchlist).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1',
      'Updated Name'
    )
  })

  it('deletes a watchlist via DELETE', async () => {
    mockDeleteWatchlist.mockResolvedValue(undefined)

    const { DELETE } = await import('@/app/api/watchlists/[watchlistId]/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists/watchlist-1?workspaceId=workspace-1'),
      {
        method: 'DELETE',
      }
    )

    const response = await DELETE(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(mockDeleteWatchlist).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1'
    )
  })
})
