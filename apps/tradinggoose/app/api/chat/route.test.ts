import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Chat API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      chat: { userId: 'userId' },
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createSuccessResponse: mockCreateSuccessResponse.mockImplementation((data) => {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      createErrorResponse: mockCreateErrorResponse.mockImplementation((message, status = 500) => {
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('@/app/api/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('returns chat deployments for the authenticated user', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      const mockDeployments = [{ id: 'deployment-1' }, { id: 'deployment-2' }]
      mockWhere.mockResolvedValue(mockDeployments)

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('@/app/api/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({ deployments: mockDeployments })
    })

    it('returns 500 when fetching deployments fails', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockWhere.mockRejectedValue(new Error('Database error'))

      const req = new NextRequest('http://localhost:3000/api/chat')
      const { GET } = await import('@/app/api/chat/route')
      const response = await GET(req)

      expect(response.status).toBe(500)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Database error', 500)
    })
  })

  describe('POST', () => {
    it('returns the current deprecation response', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const { POST } = await import('@/app/api/chat/route')
      const response = await POST(req)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('Chat publishing is managed from workflow deployment')
    })
  })
})
