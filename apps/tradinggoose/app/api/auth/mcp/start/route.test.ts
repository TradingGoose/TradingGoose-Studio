/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStartMcpDeviceLogin } = vi.hoisted(() => ({
  mockStartMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({
  startMcpDeviceLogin: (...args: unknown[]) => mockStartMcpDeviceLogin(...args),
}))

function createRequest() {
  return new NextRequest('https://studio.example.test/api/auth/mcp/start', {
    method: 'POST',
    headers: {
      'user-agent': 'test-client',
      'x-forwarded-for': '203.0.113.10',
    },
  })
}

describe('MCP login start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.example.test')
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

    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
      authorizeUrl: 'https://studio.example.test/mcp/authorize?code=login-code',
    })
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledWith(
      'https://studio.example.test:203.0.113.10:test-client'
    )
  })

  it('rate-limits browser approval login starts before issuing a code', async () => {
    mockStartMcpDeviceLogin.mockResolvedValueOnce(null)
    const { POST } = await import('./route')

    const response = await POST(createRequest())

    expect(response.status).toBe(429)
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledOnce()
  })
})
