/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckPublicApiEndpointRateLimit,
  mockIsApiKeyStorageAvailable,
  mockStartMcpDeviceLogin,
} = vi.hoisted(() => ({
  mockCheckPublicApiEndpointRateLimit: vi.fn(),
  mockIsApiKeyStorageAvailable: vi.fn(),
  mockStartMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkPublicApiEndpointRateLimit: (...args: unknown[]) =>
    mockCheckPublicApiEndpointRateLimit(...args),
}))

vi.mock('@/lib/api-key/service', () => ({
  isApiKeyStorageAvailable: (...args: unknown[]) => mockIsApiKeyStorageAvailable(...args),
}))

vi.mock('@/lib/mcp/auth', () => ({
  startMcpDeviceLogin: (...args: unknown[]) => mockStartMcpDeviceLogin(...args),
}))

describe('MCP login start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.example.test')
    mockCheckPublicApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 20,
    })
    mockIsApiKeyStorageAvailable.mockReturnValue(true)
    mockStartMcpDeviceLogin.mockResolvedValue({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('starts a browser approval login and returns an absolute approval URL', async () => {
    const { POST } = await import('./route')
    const request = new NextRequest('https://preview.example.test/api/auth/mcp/start', {
      method: 'POST',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
      authorizeUrl: 'https://studio.example.test/mcp/authorize?code=login-code',
    })
    expect(mockCheckPublicApiEndpointRateLimit).toHaveBeenCalledWith(request, 'mcp-auth-start')
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledWith()
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
      new NextRequest('https://studio.example.test/api/auth/mcp/start', { method: 'POST' })
    )

    expect(response.status).toBe(429)
    expect(mockStartMcpDeviceLogin).not.toHaveBeenCalled()
  })
})
