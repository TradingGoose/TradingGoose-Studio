/**
 * Tests for copilot confirm API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockCryptoUuid,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Confirm API Route', () => {
  const mockHasCachedValue = vi.fn()
  const mockSetCachedValue = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockHasCachedValue.mockResolvedValue(true) // Tool call exists by default
    mockSetCachedValue.mockResolvedValue(undefined)

    vi.doMock('@/lib/redis', () => ({
      hasCachedValue: mockHasCachedValue,
      setCachedValue: mockSetCachedValue,
    }))

    // Mock setTimeout to control polling behavior
    vi.spyOn(global, 'setTimeout').mockImplementation((callback, _delay) => {
      // Immediately call callback to avoid delays
      if (typeof callback === 'function') {
        setImmediate(callback)
      }
      return setTimeout(() => {}, 0) as any
    })

    // Mock Date.now to control timeout behavior
    let mockTime = 1640995200000
    vi.spyOn(Date, 'now').mockImplementation(() => {
      // Increment time rapidly to trigger timeout for non-existent keys
      mockTime += 10000 // Add 10 seconds each call
      return mockTime
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 for invalid request body - missing toolCallId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        status: 'success',
        // Missing toolCallId
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Required')
    })

    it('should return 400 for invalid request body - missing status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        // Missing status
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should return 400 for invalid status value', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'invalid-status',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid notification status')
    })

    it('should successfully confirm tool call with success status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool executed successfully',
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      // Verify Redis operations were called
      expect(mockHasCachedValue).toHaveBeenCalled()
      expect(mockSetCachedValue).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with error status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-456',
        status: 'error',
        message: 'Tool execution failed',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool execution failed',
        toolCallId: 'tool-call-456',
        status: 'error',
      })

      expect(mockSetCachedValue).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with accepted status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-789',
        status: 'accepted',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool call tool-call-789 has been accepted',
        toolCallId: 'tool-call-789',
        status: 'accepted',
      })

      expect(mockSetCachedValue).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with rejected status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-101',
        status: 'rejected',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool call tool-call-101 has been rejected',
        toolCallId: 'tool-call-101',
        status: 'rejected',
      })
    })

    it('should successfully confirm tool call with background status', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-bg',
        status: 'background',
        message: 'Moved to background execution',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Moved to background execution',
        toolCallId: 'tool-call-bg',
        status: 'background',
      })
    })

    it('should return 400 when tool call is missing', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      mockHasCachedValue.mockResolvedValue(false)

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should return 400 when tool call is not found in Redis', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock tool call as not existing in Redis
      mockHasCachedValue.mockResolvedValue(false)

      const req = createMockRequest('POST', {
        toolCallId: 'non-existent-tool',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    }, 10000) // 10 second timeout for this specific test

    it('should handle Redis errors gracefully', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock Redis operations to throw an error
      mockHasCachedValue.mockRejectedValue(new Error('Redis connection failed'))

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should handle Redis set operation failure', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Tool call exists but set operation fails
      mockHasCachedValue.mockResolvedValue(true)
      mockSetCachedValue.mockRejectedValue(new Error('Redis set failed'))

      const req = createMockRequest('POST', {
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should handle JSON parsing errors in request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Create a request with invalid JSON
      const req = new NextRequest('http://localhost:3000/api/copilot/confirm', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toContain('JSON')
    })

    it('should validate empty toolCallId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        toolCallId: '',
        status: 'success',
      })

      const { POST } = await import('@/app/api/copilot/confirm/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Tool call ID is required')
    })

    it('should handle all valid status types', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const validStatuses = ['success', 'error', 'accepted', 'rejected', 'background']

      for (const status of validStatuses) {
        const req = createMockRequest('POST', {
          toolCallId: `tool-call-${status}`,
          status,
        })

        const { POST } = await import('@/app/api/copilot/confirm/route')
        const response = await POST(req)

        expect(response.status).toBe(200)
        const responseData = await response.json()
        expect(responseData.success).toBe(true)
        expect(responseData.status).toBe(status)
        expect(responseData.toolCallId).toBe(`tool-call-${status}`)
      }
    })
  })
})
