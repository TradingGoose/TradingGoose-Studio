/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcknowledgeConnectionLogin,
  mockCheckPublicApiEndpointRateLimit,
  mockIsApiKeyStorageAvailable,
  mockPollConnectionLogin,
} = vi.hoisted(() => ({
  mockAcknowledgeConnectionLogin: vi.fn(),
  mockCheckPublicApiEndpointRateLimit: vi.fn(),
  mockIsApiKeyStorageAvailable: vi.fn(),
  mockPollConnectionLogin: vi.fn(),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkPublicApiEndpointRateLimit: (...args: unknown[]) =>
    mockCheckPublicApiEndpointRateLimit(...args),
}))

vi.mock('@/lib/api-key/service', () => ({
  isApiKeyStorageAvailable: (...args: unknown[]) => mockIsApiKeyStorageAvailable(...args),
}))

vi.mock('@/lib/connect/auth', () => ({
  acknowledgeConnectionLogin: (...args: unknown[]) => mockAcknowledgeConnectionLogin(...args),
  pollConnectionLogin: (...args: unknown[]) => mockPollConnectionLogin(...args),
}))

describe('connection login poll route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPublicApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 119,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 120,
    })
    mockIsApiKeyStorageAvailable.mockReturnValue(true)
    mockPollConnectionLogin.mockResolvedValue({
      status: 'approved',
      apiKey: 'sk-tradinggoose-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
    mockAcknowledgeConnectionLogin.mockResolvedValue({
      status: 'acknowledged',
    })
  })

  it('polls the device login by code and verification key', async () => {
    const { POST } = await import('./route')
    const request = new NextRequest('https://studio.example.test/api/auth/connect/poll', {
      method: 'POST',
      body: JSON.stringify({ code: 'login-code', verificationKey: 'verification-key' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'approved',
      apiKey: 'sk-tradinggoose-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
    expect(mockCheckPublicApiEndpointRateLimit).toHaveBeenCalledWith(request, 'connect-auth-poll')
    expect(mockPollConnectionLogin).toHaveBeenCalledWith('login-code', 'verification-key')
    expect(mockAcknowledgeConnectionLogin).not.toHaveBeenCalled()
  })

  it('acknowledges a locally persisted device login token', async () => {
    const { POST } = await import('./route')
    const request = new NextRequest('https://studio.example.test/api/auth/connect/poll', {
      method: 'POST',
      body: JSON.stringify({
        code: 'login-code',
        verificationKey: 'verification-key',
        ackApiKey: 'sk-tradinggoose-token',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'acknowledged' })
    expect(mockAcknowledgeConnectionLogin).toHaveBeenCalledWith({
      apiKey: 'sk-tradinggoose-token',
      code: 'login-code',
      verificationKey: 'verification-key',
    })
    expect(mockPollConnectionLogin).not.toHaveBeenCalled()
  })

  it('rejects malformed poll requests', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/connect/poll', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    )

    expect(response.status).toBe(400)
    expect(mockPollConnectionLogin).not.toHaveBeenCalled()
  })

  it('rejects polls when the public endpoint rate limit is exhausted', async () => {
    mockCheckPublicApiEndpointRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 120,
    })
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/connect/poll', {
        method: 'POST',
        body: JSON.stringify({ code: 'login-code', verificationKey: 'verification-key' }),
      })
    )

    expect(response.status).toBe(429)
    expect(mockPollConnectionLogin).not.toHaveBeenCalled()
  })
})
