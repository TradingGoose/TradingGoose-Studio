import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Chat Detail API Route', () => {
  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()
  const mockCheckChatAccess = vi.fn()

  beforeEach(() => {
    vi.resetModules()

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

    vi.doMock('@/lib/urls/utils', () => ({
      getEmailDomain: vi.fn().mockReturnValue('localhost:3000'),
    }))

    vi.doMock('@/app/api/chat/utils', () => ({
      checkChatAccess: mockCheckChatAccess,
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

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('returns 404 when the user cannot access the chat', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({ hasAccess: false, chat: null })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(404)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Chat not found or access denied', 404)
    })

    it('returns safe chat details when the user has access', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-id' },
        }),
      }))

      mockCheckChatAccess.mockResolvedValue({
        hasAccess: true,
        chat: {
          id: 'chat-123',
          identifier: 'test-chat',
          title: 'Test Chat',
          description: 'A test chat',
          password: 'encrypted-password',
          customizations: { primaryColor: '#000000' },
        },
      })

      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123')
      const { GET } = await import('@/app/api/chat/manage/[id]/route')
      const response = await GET(req, { params: Promise.resolve({ id: 'chat-123' }) })

      expect(response.status).toBe(200)
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
        id: 'chat-123',
        identifier: 'test-chat',
        title: 'Test Chat',
        description: 'A test chat',
        customizations: { primaryColor: '#000000' },
        chatUrl: 'https://localhost:3000/chat/test-chat',
        hasPassword: true,
      })
    })
  })

  describe('PATCH', () => {
    it('returns the current deprecation response', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })

      const { PATCH } = await import('@/app/api/chat/manage/[id]/route')
      const response = await PATCH(req, { params: Promise.resolve({ id: 'chat-123' }) })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('Chat publishing is managed from workflow deployment')
    })
  })

  describe('DELETE', () => {
    it('returns the current undeploy response', async () => {
      const req = new NextRequest('http://localhost:3000/api/chat/manage/chat-123', {
        method: 'DELETE',
      })

      const { DELETE } = await import('@/app/api/chat/manage/[id]/route')
      const response = await DELETE(req, { params: Promise.resolve({ id: 'chat-123' }) })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('Undeploy the workflow instead')
    })
  })
})
