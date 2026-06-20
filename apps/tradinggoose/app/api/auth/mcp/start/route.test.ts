/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStartMcpDeviceLogin } = vi.hoisted(() => ({
  mockStartMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({
  startMcpDeviceLogin: (...args: unknown[]) => mockStartMcpDeviceLogin(...args),
}))

describe('MCP login start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartMcpDeviceLogin.mockResolvedValue({
      code: 'login-code',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
    })
  })

  it('starts a browser approval login and returns an absolute approval URL', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/start', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: 'login-code',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
      authorizeUrl: 'https://studio.example.test/mcp/authorize?code=login-code',
    })
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledTimes(1)
  })
})
