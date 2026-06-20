/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPollMcpDeviceLogin } = vi.hoisted(() => ({
  mockPollMcpDeviceLogin: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({
  pollMcpDeviceLogin: (...args: unknown[]) => mockPollMcpDeviceLogin(...args),
}))

describe('MCP login poll route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPollMcpDeviceLogin.mockResolvedValue({
      status: 'approved',
      apiKey: 'sk-tradinggoose-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
  })

  it('polls the device login by code and verification key', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/poll', {
        method: 'POST',
        body: JSON.stringify({ code: 'login-code', verificationKey: 'verification-key' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'approved',
      apiKey: 'sk-tradinggoose-token',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
    expect(mockPollMcpDeviceLogin).toHaveBeenCalledWith('login-code', 'verification-key', {
      confirm: false,
      apiKey: undefined,
    })
  })

  it('confirms a delivered device login token', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/poll', {
        method: 'POST',
        body: JSON.stringify({
          code: 'login-code',
          verificationKey: 'verification-key',
          confirm: true,
          apiKey: 'sk-tradinggoose-token',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(mockPollMcpDeviceLogin).toHaveBeenCalledWith('login-code', 'verification-key', {
      confirm: true,
      apiKey: 'sk-tradinggoose-token',
    })
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
})
