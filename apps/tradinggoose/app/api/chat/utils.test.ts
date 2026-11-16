import type { NextResponse } from 'next/server'
/**
 * Tests for chat API utils
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_ERROR_CODES } from '@/app/chat/constants'

const mockDecryptSecret = vi.fn()

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: mockDecryptSecret,
}))
vi.mock('@/lib/environment', () => ({ isDev: true }))

describe('Chat API Utils', () => {
  beforeEach(() => {
    mockDecryptSecret.mockResolvedValue({ decrypted: 'correct-password' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Auth token utils', () => {
    it('should encrypt and validate auth tokens', async () => {
      const { encryptAuthToken, validateAuthToken } = await import('@/app/api/chat/utils')

      const chatId = 'test-chat-id'
      const type = 'password'

      const token = encryptAuthToken(chatId, type)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)

      const isValid = validateAuthToken(token, chatId)
      expect(isValid).toBe(true)

      const isInvalidChat = validateAuthToken(token, 'wrong-chat-id')
      expect(isInvalidChat).toBe(false)
    })

    it('should reject expired tokens', async () => {
      const { validateAuthToken } = await import('@/app/api/chat/utils')

      const chatId = 'test-chat-id'
      // Create an expired token by directly constructing it with an old timestamp
      const expiredToken = Buffer.from(
        `${chatId}:password:${Date.now() - 25 * 60 * 60 * 1000}`
      ).toString('base64')

      const isValid = validateAuthToken(expiredToken, chatId)
      expect(isValid).toBe(false)
    })
  })

  describe('Cookie handling', () => {
    it('should set auth cookie correctly', async () => {
      const { setChatAuthCookie } = await import('@/app/api/chat/utils')

      const mockSet = vi.fn()
      const mockResponse = {
        cookies: {
          set: mockSet,
        },
      } as unknown as NextResponse

      const chatId = 'test-chat-id'
      const type = 'password'

      setChatAuthCookie(mockResponse, chatId, type)

      expect(mockSet).toHaveBeenCalledWith({
        name: `chat_auth_${chatId}`,
        value: expect.any(String),
        httpOnly: true,
        secure: false, // Development mode
        sameSite: 'lax',
        path: '/',
        domain: undefined, // Development mode
        maxAge: 60 * 60 * 24,
      })
    })
  })

  describe('CORS handling', () => {
    it('should add CORS headers for localhost in development', async () => {
      const { addCorsHeaders } = await import('@/app/api/chat/utils')

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue('http://localhost:3000'),
        },
      } as any

      const mockResponse = {
        headers: {
          set: vi.fn(),
        },
      } as unknown as NextResponse

      addCorsHeaders(mockResponse, mockRequest)

      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:3000'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Requested-With'
      )
    })

    it('should handle OPTIONS request', async () => {
      const { OPTIONS } = await import('@/app/api/chat/utils')

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue('http://localhost:3000'),
        },
      } as any

      const response = await OPTIONS(mockRequest)

      expect(response.status).toBe(204)
    })
  })

  describe('Chat auth validation', () => {
    it('should allow access to public chats', async () => {
      const utils = await import('@/app/api/chat/utils')
      const { validateChatAuth } = utils

      const deployment = {
        id: 'chat-id',
        authType: 'public',
      }

      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(true)
    })

    it('should request password auth for GET requests', async () => {
      const { validateChatAuth } = await import('@/app/api/chat/utils')

      const deployment = {
        id: 'chat-id',
        authType: 'password',
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.code).toBe(CHAT_ERROR_CODES.AUTH_REQUIRED_PASSWORD)
    })

    it('should validate password for POST requests', async () => {
      const { validateChatAuth } = await import('@/app/api/chat/utils')
      const { decryptSecret } = await import('@/lib/utils-server')

      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const parsedBody = {
        password: 'correct-password',
      }

      const result = await validateChatAuth('request-id', deployment, mockRequest, parsedBody)

      expect(decryptSecret).toHaveBeenCalledWith('encrypted-password')
      expect(result.authorized).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const { validateChatAuth } = await import('@/app/api/chat/utils')

      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const parsedBody = {
        password: 'wrong-password',
      }

      const result = await validateChatAuth('request-id', deployment, mockRequest, parsedBody)

      expect(result.authorized).toBe(false)
      expect(result.code).toBe(CHAT_ERROR_CODES.INVALID_PASSWORD)
    })

    it('should request email auth for email-protected chats', async () => {
      const { validateChatAuth } = await import('@/app/api/chat/utils')

      const deployment = {
        id: 'chat-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.code).toBe(CHAT_ERROR_CODES.AUTH_REQUIRED_EMAIL)
    })

    it('should check allowed emails for email auth', async () => {
      const { validateChatAuth } = await import('@/app/api/chat/utils')

      const deployment = {
        id: 'chat-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result1 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'user@example.com',
      })
      expect(result1.authorized).toBe(false)
      expect(result1.code).toBe(CHAT_ERROR_CODES.OTP_REQUIRED)

      const result2 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'other@company.com',
      })
      expect(result2.authorized).toBe(false)
      expect(result2.code).toBe(CHAT_ERROR_CODES.OTP_REQUIRED)

      const result3 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'user@unknown.com',
      })
      expect(result3.authorized).toBe(false)
      expect(result3.code).toBe(CHAT_ERROR_CODES.EMAIL_NOT_AUTHORIZED)
    })
  })
})
