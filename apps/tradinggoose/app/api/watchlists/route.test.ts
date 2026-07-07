/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockCheckSessionOrInternalAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockListWatchlists = vi.fn()
const mockGetWatchlist = vi.fn()

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/watchlists/operations', async () => {
  const actual = await vi.importActual<any>('@/lib/watchlists/operations')
  return {
    ...actual,
    listWatchlists: mockListWatchlists,
    getWatchlist: mockGetWatchlist,
  }
})

describe('Watchlists API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('returns 401 when session is missing', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false, error: 'Unauthorized' })
    const { GET } = await import('@/app/api/watchlists/route')
    const request = createMockRequest('GET')
    Object.defineProperty(request, 'url', {
      value: 'http://localhost:3000/api/watchlists?workspaceId=workspace-1',
    })

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns workspace watchlists for GET', async () => {
    mockListWatchlists.mockResolvedValue([
      {
        id: 'w-1',
        workspaceId: 'workspace-1',
        name: 'Growth',
        items: [],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const { GET } = await import('@/app/api/watchlists/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists?workspaceId=workspace-1'),
      {
        method: 'GET',
      }
    )

    const response = await GET(request)
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.watchlists).toHaveLength(1)
    expect(mockListWatchlists).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
  })

  it('keeps GET as a root-list endpoint even when watchlistId is supplied', async () => {
    mockListWatchlists.mockResolvedValue([])
    const { GET } = await import('@/app/api/watchlists/route')
    const request = new NextRequest(
      new URL('http://localhost:3000/api/watchlists?workspaceId=workspace-1&watchlistId=w-1'),
      {
        method: 'GET',
      }
    )

    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ watchlists: [] })
    expect(mockListWatchlists).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
    expect(mockGetWatchlist).not.toHaveBeenCalled()
  })

})
