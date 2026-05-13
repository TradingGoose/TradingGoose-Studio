/**
 * Tests for OAuth connections API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('OAuth Connections API Route', () => {
  const mockGetSession = vi.fn()
  const mockListOAuthConnectionsForUser = vi.fn()
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    vi.doMock('@/lib/auth', () => ({
      getSession: mockGetSession,
    }))

    vi.doMock('@/lib/credentials/oauth', () => ({
      listOAuthConnectionsForUser: mockListOAuthConnectionsForUser,
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return connections successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const mockCredentials = [
      {
        id: 'credential-1',
        provider: 'google-email',
        name: 'Gmail Account',
        scopes: ['email', 'profile'],
        lastUsed: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'credential-3',
        provider: 'google-email',
        name: 'Work Gmail Account',
        scopes: ['email', 'gmail.modify'],
        lastUsed: '2024-01-03T00:00:00.000Z',
      },
      {
        id: 'credential-2',
        provider: 'github',
        name: 'GitHub Account',
        scopes: ['repo'],
        lastUsed: '2024-01-02T00:00:00.000Z',
      },
    ]

    mockListOAuthConnectionsForUser.mockResolvedValueOnce(mockCredentials)

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections).toHaveLength(2)
    expect(data.connections[0]).toMatchObject({
      provider: 'google-email',
      baseProvider: 'google',
      featureType: 'gmail',
      isConnected: true,
    })
    expect(data.connections[0].accounts).toEqual([
      { id: 'credential-1', name: 'Gmail Account' },
      { id: 'credential-3', name: 'Work Gmail Account' },
    ])
    expect(data.connections[0].scopes).toEqual(['email', 'profile', 'gmail.modify'])
    expect(data.connections[0].lastConnected).toBe('2024-01-03T00:00:00.000Z')
    expect(data.connections[1]).toMatchObject({
      provider: 'github',
      baseProvider: 'github',
      featureType: 'github',
      isConnected: true,
    })
  })

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle user with no connections', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockListOAuthConnectionsForUser.mockResolvedValueOnce([])

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections).toHaveLength(0)
  })

  it('should handle database error', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockListOAuthConnectionsForUser.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('should use the canonical credential display name', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockListOAuthConnectionsForUser.mockResolvedValueOnce([
      {
        id: 'credential-1',
        provider: 'google',
        name: 'Canonical Google Credential',
        scopes: ['email', 'profile'],
        lastUsed: '2024-01-01T00:00:00.000Z',
      },
    ])

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections[0].accounts[0].name).toBe('Canonical Google Credential')
  })
})
