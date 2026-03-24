/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('OAuth Credentials API Route', () => {
  const mockCheckHybridAuth = vi.fn()
  const mockGetUserEntityPermissions = vi.fn()
  const mockParseProvider = vi.fn()
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  }
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  function createMockRequestWithQuery(method = 'GET', queryParams = ''): NextRequest {
    const url = `http://localhost:3000/api/auth/oauth/credentials${queryParams}`
    return new NextRequest(new URL(url), { method })
  }

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    mockParseProvider.mockImplementation((providerId: string) => {
      switch (providerId) {
        case 'google-email':
          return { baseProvider: 'google', featureType: 'gmail' }
        case 'google-drive':
          return { baseProvider: 'google', featureType: 'google-drive' }
        case 'google':
          return { baseProvider: 'google', featureType: 'default' }
        default:
          return { baseProvider: providerId.split('-')[0], featureType: 'default' }
      }
    })

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: mockCheckHybridAuth,
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: mockGetUserEntityPermissions,
    }))

    vi.doMock('@/lib/oauth', () => ({
      parseProvider: mockParseProvider,
      OAUTH_PROVIDERS: {
        google: { defaultService: 'gmail' },
      },
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      account: { id: 'id', userId: 'userId', providerId: 'providerId' },
      user: { email: 'email', id: 'id' },
      workflow: { id: 'id', userId: 'userId', workspaceId: 'workspaceId' },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))

    vi.doMock('jwt-decode', () => ({
      jwtDecode: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return credentials successfully', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    const mockAccounts = [
      {
        id: 'credential-1',
        userId: 'user-123',
        providerId: 'google-email',
        accountId: 'test@example.com',
        updatedAt: new Date('2024-01-01'),
        idToken: null,
        scope: null,
      },
      {
        id: 'credential-2',
        userId: 'user-123',
        providerId: 'google-drive',
        accountId: 'drive-user-id',
        updatedAt: new Date('2024-01-02'),
        idToken: null,
        scope: 'https://www.googleapis.com/auth/drive.file',
      },
    ]

    mockDb.where.mockResolvedValueOnce(mockAccounts)
    mockDb.limit.mockResolvedValueOnce([{ email: 'user@example.com' }])
    mockDb.limit.mockResolvedValueOnce([{ email: 'user@example.com' }])

    const req = createMockRequestWithQuery('GET', '?provider=google-email')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(2)
    expect(data.credentials[0]).toMatchObject({
      id: 'credential-1',
      provider: 'google-email',
      isDefault: true,
      scopes: [],
    })
    expect(data.credentials[1]).toMatchObject({
      id: 'credential-2',
      provider: 'google-drive',
      isDefault: false,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    })
  })

  it('should handle unauthenticated user', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'User not authenticated',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle missing provider parameter', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    const req = createMockRequestWithQuery('GET')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle no credentials found', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockDb.where.mockResolvedValueOnce([])

    const req = createMockRequestWithQuery('GET', '?provider=github')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should decode ID token for display name', async () => {
    const { jwtDecode } = await import('jwt-decode')
    const mockJwtDecode = jwtDecode as any

    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockDb.where.mockResolvedValueOnce([
      {
        id: 'credential-1',
        userId: 'user-123',
        providerId: 'google-email',
        accountId: 'google-user-id',
        updatedAt: new Date('2024-01-01'),
        idToken: 'mock-jwt-token',
        scope: 'email profile',
      },
    ])

    mockJwtDecode.mockReturnValueOnce({
      email: 'decoded@example.com',
      name: 'Decoded User',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials[0].name).toBe('decoded@example.com')
  })

  it('should handle database error', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequestWithQuery('GET', '?provider=google')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
