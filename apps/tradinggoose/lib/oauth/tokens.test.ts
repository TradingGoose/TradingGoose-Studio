/**
 * Tests for OAuth token functions
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('OAuth Tokens', () => {
  const mockSession = { user: { id: 'test-user-id' } }
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  }
  const mockRefreshOAuthToken = vi.fn()
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(mockSession),
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@/lib/oauth/oauth', () => ({
      getMicrosoftRefreshTokenExpiry: vi.fn(() => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)),
      isMicrosoftProvider: vi.fn((providerId: string) => providerId === 'outlook'),
      PROACTIVE_REFRESH_THRESHOLD_DAYS: 7,
    }))

    vi.doMock('@/lib/oauth/oauth.server', () => ({
      refreshOAuthToken: mockRefreshOAuthToken,
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserId', () => {
    it('should get user ID from session when no workflowId is provided', async () => {
      const { getUserId } = await import('@/lib/oauth/tokens')

      const userId = await getUserId('request-id')

      expect(userId).toBe('test-user-id')
    })

    it('should get user ID from workflow when workflowId is provided', async () => {
      mockDb.limit.mockReturnValueOnce([{ userId: 'workflow-owner-id' }])

      const { getUserId } = await import('@/lib/oauth/tokens')

      const userId = await getUserId('request-id', 'workflow-id')

      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb.from).toHaveBeenCalled()
      expect(mockDb.where).toHaveBeenCalled()
      expect(mockDb.limit).toHaveBeenCalledWith(1)
      expect(userId).toBe('workflow-owner-id')
    })

    it('should return undefined if no session is found', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const { getUserId } = await import('@/lib/oauth/tokens')

      const userId = await getUserId('request-id')

      expect(userId).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should return undefined if workflow is not found', async () => {
      mockDb.limit.mockReturnValueOnce([])

      const { getUserId } = await import('@/lib/oauth/tokens')

      const userId = await getUserId('request-id', 'nonexistent-workflow-id')

      expect(userId).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })

  describe('getCredential', () => {
    it('should return credential when found', async () => {
      const mockCredential = { id: 'credential-id', userId: 'test-user-id' }
      mockDb.limit.mockReturnValueOnce([mockCredential])

      const { getCredential } = await import('@/lib/oauth/tokens')

      const credential = await getCredential('request-id', 'credential-id', 'test-user-id')

      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb.from).toHaveBeenCalled()
      expect(mockDb.where).toHaveBeenCalled()
      expect(mockDb.limit).toHaveBeenCalledWith(1)

      expect(credential).toEqual(mockCredential)
    })

    it('should return undefined when credential is not found', async () => {
      mockDb.limit.mockReturnValueOnce([])

      const { getCredential } = await import('@/lib/oauth/tokens')

      const credential = await getCredential('request-id', 'nonexistent-id', 'test-user-id')

      expect(credential).toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })

  describe('getOAuthToken', () => {
    it('should return a valid access token for a single provider connection', async () => {
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id',
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
      ])

      const { getOAuthToken } = await import('@/lib/oauth/tokens')

      const token = await getOAuthToken('test-user-id', 'alpaca')

      expect(token).toBe('valid-token')
      expect(mockDb.limit).toHaveBeenCalledWith(2)
      expect(mockDb.orderBy).not.toHaveBeenCalled()
    })

    it('should return null when no provider connection exists', async () => {
      mockDb.limit.mockReturnValueOnce([])

      const { getOAuthToken } = await import('@/lib/oauth/tokens')

      const token = await getOAuthToken('test-user-id', 'alpaca')

      expect(token).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No OAuth token found for user test-user-id, provider alpaca'
      )
    })

    it('should reject duplicate provider connections instead of choosing one', async () => {
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id-1',
          accessToken: 'first-token',
          refreshToken: 'refresh-token-1',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
        {
          id: 'credential-id-2',
          accessToken: 'second-token',
          refreshToken: 'refresh-token-2',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
      ])

      const { getOAuthToken } = await import('@/lib/oauth/tokens')

      const token = await getOAuthToken('test-user-id', 'alpaca')

      expect(token).toBeNull()
      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Multiple OAuth connections found for user test-user-id, provider alpaca',
        {
          providerId: 'alpaca',
          userId: 'test-user-id',
        }
      )
    })

    it('should refresh an expired token for a single provider connection', async () => {
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id',
          accessToken: 'expired-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        },
      ])
      mockRefreshOAuthToken.mockResolvedValueOnce({
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const { getOAuthToken } = await import('@/lib/oauth/tokens')

      const token = await getOAuthToken('test-user-id', 'alpaca')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('alpaca', 'refresh-token')
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-token',
          refreshToken: 'new-refresh-token',
        })
      )
      expect(token).toBe('new-token')
    })
  })

  describe('getOAuthTokenByCredentialId', () => {
    it('should return a valid access token for the selected credential row', async () => {
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id',
          userId: 'test-user-id',
          providerId: 'alpaca-live',
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
      ])

      const { getOAuthTokenByCredentialId } = await import('@/lib/oauth/tokens')

      const token = await getOAuthTokenByCredentialId({
        userId: 'test-user-id',
        credentialId: 'credential-id',
        providerId: 'alpaca-live',
        requestId: 'request-id',
      })

      expect(token).toBe('valid-token')
      expect(mockDb.limit).toHaveBeenCalledWith(1)
      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
    })

    it('should reject credentials from a different service id', async () => {
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id',
          userId: 'test-user-id',
          providerId: 'alpaca-paper',
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
      ])

      const { getOAuthTokenByCredentialId } = await import('@/lib/oauth/tokens')

      const token = await getOAuthTokenByCredentialId({
        userId: 'test-user-id',
        credentialId: 'credential-id',
        providerId: 'alpaca-live',
        requestId: 'request-id',
      })

      expect(token).toBeNull()
      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith('[request-id] Credential provider mismatch', {
        credentialId: 'credential-id',
        expectedProviderId: 'alpaca-live',
        actualProviderId: 'alpaca-paper',
      })
    })
  })

  describe('refreshTokenIfNeeded', () => {
    it('should return valid token without refresh if not expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour in the future
        providerId: 'google',
      }

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'valid-token', refreshed: false })
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Access token is valid'))
    })

    it('should refresh token when expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        providerId: 'google',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce({
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'new-token', refreshed: true })
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully refreshed')
      )
    })

    it('should handle refresh token error', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        providerId: 'google',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      await expect(
        refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')
      ).rejects.toThrow('Failed to refresh token')

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should proactively refresh Microsoft tokens before refresh token expiry', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        providerId: 'outlook',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce({
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('outlook', 'refresh-token')
      expect(result).toEqual({ accessToken: 'new-token', refreshed: true })
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-token',
          refreshToken: 'new-refresh-token',
          refreshTokenExpiresAt: expect.any(Date),
        })
      )
    })

    it('should keep the current access token if proactive refresh fails', async () => {
      const mockCredential = {
        id: 'credential-id',
        userId: 'test-user-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        providerId: 'outlook',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(result).toEqual({ accessToken: 'valid-token', refreshed: false })
      expect(mockDb.limit).not.toHaveBeenCalled()
    })

    it('should use the DB token when another request refreshed concurrently', async () => {
      const mockCredential = {
        id: 'credential-id',
        userId: 'test-user-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce(null)
      mockDb.limit.mockReturnValueOnce([
        {
          id: 'credential-id',
          userId: 'test-user-id',
          accessToken: 'concurrent-token',
          refreshToken: 'rotated-refresh-token',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
          providerId: 'google',
        },
      ])

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(result).toEqual({ accessToken: 'concurrent-token', refreshed: true })
    })

    it('should not attempt refresh if no refresh token', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'token',
        refreshToken: null,
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        providerId: 'google',
      }

      const { refreshTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'token', refreshed: false })
    })
  })

  describe('refreshAccessTokenIfNeeded', () => {
    it('should return valid access token without refresh if not expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour in the future
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockDb.limit.mockReturnValueOnce([mockCredential])

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(token).toBe('valid-token')
    })

    it('should refresh token when expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockDb.limit.mockReturnValueOnce([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce({
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.set).toHaveBeenCalled()
      expect(token).toBe('new-token')
    })

    it('should return null if credential not found', async () => {
      mockDb.limit.mockReturnValueOnce([])

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('nonexistent-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should return null if refresh fails', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockDb.limit.mockReturnValueOnce([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should keep the current access token if proactive refresh fails', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        providerId: 'outlook',
        userId: 'test-user-id',
      }
      mockDb.limit.mockReturnValueOnce([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBe('valid-token')
    })

    it('should use the DB token when another request refreshed concurrently', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockDb.limit.mockReturnValueOnce([mockCredential]).mockReturnValueOnce([
        {
          ...mockCredential,
          accessToken: 'concurrent-token',
          refreshToken: 'rotated-refresh-token',
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        },
      ])

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBe('concurrent-token')
    })
  })
})
