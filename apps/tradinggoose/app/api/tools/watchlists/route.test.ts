/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
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
    addListingToWatchlist: vi.fn(),
    checkAuth: vi.fn(),
    checkWorkspaceAccess: vi.fn(),
    listWatchlists: vi.fn(),
    removeListingFromWatchlist: vi.fn(),
  }
})

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: (...args: unknown[]) => mocks.checkAuth(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn() })),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mocks.checkWorkspaceAccess(...args),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/lib/watchlists/operations', () => ({
  WatchlistOperationError: mocks.WatchlistOperationError,
  addListingToWatchlist: (...args: unknown[]) => mocks.addListingToWatchlist(...args),
  getWatchlist: vi.fn(),
  listWatchlists: (...args: unknown[]) => mocks.listWatchlists(...args),
  removeListingFromWatchlist: (...args: unknown[]) => mocks.removeListingFromWatchlist(...args),
}))

const workspaceId = 'workspace-1'
const userId = 'user-1'
const listing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}
const watchlist = {
  id: 'watchlist-1',
  workspaceId,
  userId,
  name: 'Default',
  isSystem: true,
  items: [{ id: 'item-1', type: 'listing', listing }],
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
}

const post = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost:3000/api/tools/watchlists', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

describe('watchlist tools route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkAuth.mockResolvedValue({ success: true, userId })
    mocks.checkWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: workspaceId },
    })
    mocks.listWatchlists.mockResolvedValue([watchlist])
    mocks.addListingToWatchlist.mockResolvedValue(watchlist)
    mocks.removeListingFromWatchlist.mockResolvedValue(watchlist)
  })

  it('reads watchlist lists through existing watchlist operations', async () => {
    const { POST } = await import('./route')

    const response = await POST(post({ operation: 'readLists', workspaceId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { watchlists: [expect.objectContaining({ id: 'watchlist-1' })] },
    })
    expect(mocks.listWatchlists).toHaveBeenCalledWith({ workspaceId, userId })
  })

  it('adds listings through existing watchlist operations', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      post({ operation: 'addListing', workspaceId, watchlistId: 'watchlist-1', listing })
    )

    expect(response.status).toBe(200)
    expect(mocks.addListingToWatchlist).toHaveBeenCalledWith(
      { workspaceId, userId },
      'watchlist-1',
      listing
    )
  })

  it('removes listings by listing identity through existing watchlist operations', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      post({ operation: 'removeListing', workspaceId, watchlistId: 'watchlist-1', listing })
    )

    expect(response.status).toBe(200)
    expect(mocks.removeListingFromWatchlist).toHaveBeenCalledWith(
      { workspaceId, userId },
      'watchlist-1',
      listing
    )
  })

  it('uses workspace write access for mutations', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: workspaceId },
    })
    const { POST } = await import('./route')

    const response = await POST(
      post({
        operation: 'removeListing',
        workspaceId,
        watchlistId: 'watchlist-1',
        listing,
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.removeListingFromWatchlist).not.toHaveBeenCalled()
  })
})
