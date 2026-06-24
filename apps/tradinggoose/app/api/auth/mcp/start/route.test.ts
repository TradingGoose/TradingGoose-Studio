/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockMcpDeviceLoginRateLimitError, mockStartMcpDeviceLogin } = vi.hoisted(() => ({
  MockMcpDeviceLoginRateLimitError: class extends Error {},
  mockStartMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({
  McpDeviceLoginRateLimitError: MockMcpDeviceLoginRateLimitError,
  startMcpDeviceLogin: (...args: unknown[]) => mockStartMcpDeviceLogin(...args),
}))

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

    const response = await POST()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: 'login-code',
      verificationKey: 'verification-key',
      expiresAt: '2026-06-19T12:00:00.000Z',
      intervalSeconds: 2,
      authorizeUrl: 'https://studio.example.test/mcp/authorize?code=login-code',
    })
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledWith('public:studio.example.test')
  })

  it('returns 429 when too many approval logins are active for the requester', async () => {
    const { POST } = await import('./route')
    mockStartMcpDeviceLogin.mockRejectedValueOnce(
      new MockMcpDeviceLoginRateLimitError(
        'Too many active MCP login attempts. Please wait for existing attempts to expire.'
      )
    )

    const response = await POST()

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many active MCP login attempts. Please wait for existing attempts to expire.',
    })
    expect(mockStartMcpDeviceLogin).toHaveBeenCalledWith('public:studio.example.test')
  })
})
