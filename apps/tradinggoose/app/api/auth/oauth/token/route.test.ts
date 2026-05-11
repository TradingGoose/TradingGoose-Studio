/**
 * Tests for OAuth token API routes
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('OAuth Token API Routes', () => {
  const mockGetCredential = vi.fn()
  const mockGetOAuthToken = vi.fn()
  const mockRefreshTokenIfNeeded = vi.fn()
  const mockAuthorizeCredentialUse = vi.fn()
  const mockCheckHybridAuth = vi.fn()

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'
  const mockRequestId = mockUUID.slice(0, 8)

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    vi.doMock('@/lib/oauth/tokens', () => ({
      getCredential: mockGetCredential,
      getOAuthToken: mockGetOAuthToken,
      refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/auth/credential-access', () => ({
      authorizeCredentialUse: mockAuthorizeCredentialUse,
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: mockCheckHybridAuth,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST handler', () => {
    it('should return access token successfully', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
        idToken: 'id-token-value',
      })
      mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')
      expect(data).toHaveProperty('idToken', 'id-token-value')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(mockGetCredential).toHaveBeenCalled()
      expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle workflowId for server-side authentication', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'internal_jwt',
        requesterUserId: 'workflow-owner-id',
        credentialOwnerUserId: 'workflow-owner-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'workflow-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(mockGetCredential).toHaveBeenCalled()
    })

    it('should resolve access token by serviceId for internal workflow calls', async () => {
      mockCheckHybridAuth.mockResolvedValueOnce({
        success: true,
        authType: 'internal_jwt',
        userId: 'acting-user-id',
      })
      mockGetOAuthToken.mockResolvedValueOnce('service-token')

      const req = createMockRequest('POST', {
        serviceId: 'alpaca-live',
        workflowId: 'workflow-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toMatchObject({
        accessToken: 'service-token',
        providerId: 'alpaca-live',
      })
      expect(mockGetOAuthToken).toHaveBeenCalledWith('acting-user-id', 'alpaca-live')
      expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
      expect(mockGetCredential).not.toHaveBeenCalled()
    })

    it('should reject serviceId lookup when the internal token has no acting user', async () => {
      mockCheckHybridAuth.mockResolvedValueOnce({
        success: true,
        authType: 'internal_jwt',
      })

      const req = createMockRequest('POST', {
        serviceId: 'alpaca-live',
        workflowId: 'workflow-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toMatchObject({ error: 'User not authenticated' })
      expect(mockGetOAuthToken).not.toHaveBeenCalled()
      expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    })

    it('should handle missing credentialId and serviceId', async () => {
      const req = createMockRequest('POST', {})

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Credential ID or service ID is required')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle authentication failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: false,
        error: 'Authentication required',
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should handle workflow not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Workflow not found' })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'nonexistent-workflow-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
    })

    it('should handle credential not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'nonexistent-credential-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Credential not found')
    })

    it('should handle token refresh failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockRejectedValueOnce(new Error('Refresh failure'))

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const { POST } = await import('@/app/api/auth/oauth/token/route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Failed to refresh access token')
    })
  })
})
