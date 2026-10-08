/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckPublicApiEndpointRateLimit,
  mockIsApiKeyStorageAvailable,
  mockStartConnectionLogin,
} = vi.hoisted(() => ({
  mockCheckPublicApiEndpointRateLimit: vi.fn(),
  mockIsApiKeyStorageAvailable: vi.fn(),
  mockStartConnectionLogin: vi.fn(),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkPublicApiEndpointRateLimit: (...args: unknown[]) =>
    mockCheckPublicApiEndpointRateLimit(...args),
}))

vi.mock('@/lib/api-key/service', () => ({
  isApiKeyStorageAvailable: (...args: unknown[]) => mockIsApiKeyStorageAvailable(...args),
}))

vi.mock('@/lib/connect/auth', () => ({
  startConnectionLogin: (...args: unknown[]) => mockStartConnectionLogin(...args),
}))

describe('connection login start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPublicApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 20,
    })
    mockIsApiKeyStorageAvailable.mockReturnValue(true)
    mockStartConnectionLogin.mockResolvedValue({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
    })
  })

  it('starts a browser approval login', async () => {
    const { POST } = await import('./route')
    const request = new NextRequest('https://preview.example.test/api/auth/connect/start', {
      method: 'POST',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
    })
    expect(mockCheckPublicApiEndpointRateLimit).toHaveBeenCalledWith(request, 'connect-auth-start')
    expect(mockStartConnectionLogin).toHaveBeenCalledWith()
  })

  it('rejects login starts when the public endpoint rate limit is exhausted', async () => {
    mockCheckPublicApiEndpointRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 20,
    })
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/connect/start', { method: 'POST' })
    )

    expect(response.status).toBe(429)
    expect(mockStartConnectionLogin).not.toHaveBeenCalled()
  })
})
