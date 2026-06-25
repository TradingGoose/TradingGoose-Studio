/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckPublicApiEndpointRateLimit, mockPollMcpDeviceLogin } = vi.hoisted(() => ({
  mockCheckPublicApiEndpointRateLimit: vi.fn(),
  mockPollMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  checkPublicApiEndpointRateLimit: (...args: unknown[]) =>
    mockCheckPublicApiEndpointRateLimit(...args),
}))

vi.mock('@/lib/mcp/auth', () => ({
  pollMcpDeviceLogin: (...args: unknown[]) => mockPollMcpDeviceLogin(...args),
}))

describe('MCP login poll route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPublicApiEndpointRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 119,
      resetAt: new Date('2026-06-19T12:01:00.000Z'),
      limit: 120,
    })
    mockPollMcpDeviceLogin.mockResolvedValue({
      status: 'approved',
      apiKey: 'sk-tradinggoose-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
  })

  it('polls the device login by code and verification key', async () => {
    const { POST } = await import('./route')
    const request = new NextRequest('https://studio.example.test/api/auth/mcp/poll', {
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
    expect(mockCheckPublicApiEndpointRateLimit).toHaveBeenCalledWith(request, 'mcp-auth-poll')
    expect(mockPollMcpDeviceLogin).toHaveBeenCalledWith('login-code', 'verification-key')
  })

  it('rejects malformed poll requests', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/poll', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    )

    expect(response.status).toBe(400)
    expect(mockPollMcpDeviceLogin).not.toHaveBeenCalled()
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
      new NextRequest('https://studio.example.test/api/auth/mcp/poll', {
        method: 'POST',
        body: JSON.stringify({ code: 'login-code', verificationKey: 'verification-key' }),
      })
    )

    expect(response.status).toBe(429)
    expect(mockPollMcpDeviceLogin).not.toHaveBeenCalled()
  })
})
