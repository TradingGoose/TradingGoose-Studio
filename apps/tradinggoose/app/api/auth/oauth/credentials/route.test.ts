/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('OAuth Credentials API Route', () => {
  const mockCheckSessionOrInternalAuth = vi.fn()
  const mockCheckWorkspaceAccess = vi.fn()
  const mockParseProvider = vi.fn()
  const mockListOAuthCredentialsForUser = vi.fn()
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
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
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })

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
      AuthType: {
        SESSION: 'session',
        API_KEY: 'api_key',
        INTERNAL_JWT: 'internal_jwt',
      },
      checkHybridAuth: mockCheckSessionOrInternalAuth,
    }))

    vi.doMock('@/lib/credentials/oauth', () => ({
      listOAuthCredentialsForUser: mockListOAuthCredentialsForUser,
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      checkWorkspaceAccess: mockCheckWorkspaceAccess,
    }))

    vi.doMock('@/lib/oauth', () => ({
      parseProvider: mockParseProvider,
      getCanonicalScopesForProvider: vi.fn(() => ['canonical-scope']),
      OAUTH_PROVIDERS: {
        google: {
          defaultService: 'gmail',
          services: {
            gmail: { providerId: 'google-email' },
            'google-drive': { providerId: 'google-drive' },
          },
        },
      },
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      account: { id: 'id', userId: 'userId', providerId: 'providerId' },
      credential: {
        id: 'credentialId',
        workspaceId: 'workspaceId',
        type: 'type',
        displayName: 'displayName',
        accountId: 'accountId',
      },
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
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    const mockCredentials = [
      {
        id: 'credential-1',
        provider: 'google-email',
        name: 'Gmail Account',
        lastUsed: '2024-01-01T00:00:00.000Z',
        isDefault: true,
        scopes: ['canonical-scope'],
      },
      {
        id: 'credential-2',
        provider: 'google-drive',
        name: 'Drive Account',
        lastUsed: '2024-01-02T00:00:00.000Z',
        isDefault: false,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    ]

    mockListOAuthCredentialsForUser.mockResolvedValueOnce(mockCredentials)

    const req = createMockRequestWithQuery('GET', '?provider=google-email&workspaceId=workspace-1')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(2)
    expect(data.credentials[0]).toMatchObject({
      id: 'credential-1',
      provider: 'google-email',
      isDefault: true,
      name: 'Gmail Account',
      scopes: ['canonical-scope'],
    })
    expect(data.credentials[1]).toMatchObject({
      id: 'credential-2',
      provider: 'google-drive',
      isDefault: false,
      name: 'Drive Account',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    })
  })

  it('should handle unauthenticated user', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    const req = createMockRequestWithQuery('GET', '?workspaceId=workspace-1')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle no credentials found', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockListOAuthCredentialsForUser.mockResolvedValueOnce([])

    const req = createMockRequestWithQuery('GET', '?provider=github&workspaceId=workspace-1')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should use the canonical credential display name', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockListOAuthCredentialsForUser.mockResolvedValueOnce([
      {
        id: 'credential-1',
        provider: 'google-email',
        name: 'Canonical Gmail Credential',
        lastUsed: '2024-01-01T00:00:00.000Z',
        isDefault: true,
        scopes: ['email', 'profile'],
      },
    ])

    const req = createMockRequestWithQuery('GET', '?provider=google&workspaceId=workspace-1')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials[0].name).toBe('Canonical Gmail Credential')
  })

  it('scopes workflow credential lookups to the workflow workspace', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'collaborator-1',
    })
    mockDb.limit.mockResolvedValueOnce([{ workspaceId: 'workspace-1' }])
    mockCheckWorkspaceAccess.mockResolvedValueOnce({ hasAccess: true })
    mockListOAuthCredentialsForUser.mockResolvedValueOnce([
      {
        id: 'credential-1',
        provider: 'google-email',
        name: 'Shared Gmail Credential',
        lastUsed: '2024-01-01T00:00:00.000Z',
        isDefault: true,
        scopes: ['canonical-scope'],
      },
    ])

    const req = createMockRequestWithQuery(
      'GET',
      '?workflowId=workflow-1&credentialId=credential-1'
    )
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials[0]).toMatchObject({
      id: 'credential-1',
      provider: 'google-email',
      name: 'Shared Gmail Credential',
    })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'collaborator-1')
  })

  it('should handle database error', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      authType: 'session',
      userId: 'user-123',
    })

    mockListOAuthCredentialsForUser.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequestWithQuery('GET', '?provider=google&workspaceId=workspace-1')
    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
