/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRevokeMcpApiKeyByBearerToken } = vi.hoisted(() => ({
  mockRevokeMcpApiKeyByBearerToken: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({
  revokeMcpApiKeyByBearerToken: (...args: unknown[]) => mockRevokeMcpApiKeyByBearerToken(...args),
}))

describe('MCP auth revoke route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRevokeMcpApiKeyByBearerToken.mockResolvedValue({ revoked: true })
  })

  it('revokes the bearer API key', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/revoke', {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-tradinggoose-old',
        },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ revoked: true })
    expect(mockRevokeMcpApiKeyByBearerToken).toHaveBeenCalledWith('sk-tradinggoose-old')
  })

  it('accepts a case-insensitive bearer auth scheme', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/revoke', {
        method: 'POST',
        headers: {
          authorization: 'bearer sk-tradinggoose-old',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockRevokeMcpApiKeyByBearerToken).toHaveBeenCalledWith('sk-tradinggoose-old')
  })

  it('rejects missing bearer auth', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('https://studio.example.test/api/auth/mcp/revoke', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(400)
    expect(mockRevokeMcpApiKeyByBearerToken).not.toHaveBeenCalled()
  })
})
