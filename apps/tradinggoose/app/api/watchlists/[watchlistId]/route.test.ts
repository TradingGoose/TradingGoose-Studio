/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockDeleteWatchlist = vi.fn()
const mockGetWatchlist = vi.fn()

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
    deleteWatchlist: mockDeleteWatchlist,
    getWatchlist: mockGetWatchlist,
  }
})

describe('Watchlist by id API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
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
      },
      'watchlist-1'
    )
  })

  it('reads a watchlist via GET', async () => {
    mockGetWatchlist.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      name: 'Growth',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [],
      createdAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    })

    const { GET } = await import('@/app/api/watchlists/[watchlistId]/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists/watchlist-1?workspaceId=workspace-1'),
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.watchlist).toMatchObject({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      name: 'Growth',
      items: [],
    })
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'user-1',
      'workspace',
      'workspace-1'
    )
    expect(mockGetWatchlist).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
      },
      'watchlist-1'
    )
  })
})
