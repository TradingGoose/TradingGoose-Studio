/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockListWatchlists = vi.fn()
const mockCreateWatchlist = vi.fn()

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
    listWatchlists: mockListWatchlists,
    createWatchlist: mockCreateWatchlist,
  }
})

describe('Watchlists API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)
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
        userId: 'user-1',
        name: 'Default',
        isSystem: true,
        items: [],
        settings: { showLogo: true, showTicker: true, showDescription: true },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const { GET } = await import('@/app/api/watchlists/route')
    const request = new NextRequest(new URL('http://localhost:3000/api/watchlists?workspaceId=workspace-1'), {
      method: 'GET',
    })

    const response = await GET(request)
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.watchlists).toHaveLength(1)
    expect(mockListWatchlists).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
  })

  it('creates a watchlist through POST', async () => {
    mockCreateWatchlist.mockResolvedValue({
      id: 'w-2',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Momentum',
      isSystem: false,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { POST } = await import('@/app/api/watchlists/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      name: 'Momentum',
    })

    const response = await POST(request)
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.watchlist.name).toBe('Momentum')
    expect(mockCreateWatchlist).toHaveBeenCalled()
  })
})
