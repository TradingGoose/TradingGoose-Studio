/**
 * Tests for OAuth disconnect API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('OAuth Disconnect API Route', () => {
  const mockGetSession = vi.fn()
  const mockDb = {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn(),
  }
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

    vi.doMock('@tradinggoose/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      account: { id: 'id', userId: 'userId', providerId: 'providerId' },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should disconnect a single OAuth account by account id', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      accountId: 'account-row-1',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockDb.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', field: 'userId', value: 'user-123' },
        { type: 'eq', field: 'id', value: 'account-row-1' },
      ],
    })
  })

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('POST', {
      accountId: 'account-row-1',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle missing account id', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequest('POST', {})

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('accountId is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle database error', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('POST', {
      accountId: 'account-row-1',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
