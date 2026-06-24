/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApproveMcpDeviceLogin,
  mockCancelMcpDeviceLogin,
  mockGetBaseUrl,
  mockGetSession,
  mockGetSessionCookie,
} = vi.hoisted(() => ({
  mockApproveMcpDeviceLogin: vi.fn(),
  mockCancelMcpDeviceLogin: vi.fn(),
  mockGetBaseUrl: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetSessionCookie: vi.fn(),
}))

vi.mock('better-auth/cookies', () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/mcp/auth', () => ({
  approveMcpDeviceLogin: (...args: unknown[]) => mockApproveMcpDeviceLogin(...args),
  cancelMcpDeviceLogin: (...args: unknown[]) => mockCancelMcpDeviceLogin(...args),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => mockGetBaseUrl(),
}))

function createAuthorizeRequest(
  body: Record<string, string>,
  headers: Record<string, string> = {}
) {
  return new NextRequest('https://studio.example.test/api/auth/mcp/authorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://studio.example.test',
      ...headers,
    },
    body: new URLSearchParams(body),
  })
}

describe('MCP authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBaseUrl.mockReturnValue('https://studio.example.test')
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetSessionCookie.mockReturnValue(null)
    mockApproveMcpDeviceLogin.mockResolvedValue({
      status: 'approved',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
    mockCancelMcpDeviceLogin.mockResolvedValue({ status: 'cancelled' })
  })

  it('approves a device login from an explicit submitted confirmation', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createAuthorizeRequest({
        action: 'approve',
        approvalToken: 'approval-token',
        code: 'login-code',
        locale: 'es',
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/mcp/authorize?status=approved'
    )
    expect(mockApproveMcpDeviceLogin).toHaveBeenCalledWith({
      approvalToken: 'approval-token',
      code: 'login-code',
      userId: 'user-1',
    })
    expect(mockCancelMcpDeviceLogin).not.toHaveBeenCalled()
  })

  it('cancels a pending device login from an explicit submitted confirmation', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createAuthorizeRequest({
        action: 'cancel',
        approvalToken: 'approval-token',
        code: 'login-code',
        locale: 'zh',
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/zh/mcp/authorize?status=cancelled'
    )
    expect(mockCancelMcpDeviceLogin).toHaveBeenCalledWith({
      approvalToken: 'approval-token',
      code: 'login-code',
      userId: 'user-1',
    })
    expect(mockApproveMcpDeviceLogin).not.toHaveBeenCalled()
  })

  it('rejects malformed confirmation submissions before auth mutation', async () => {
    const { POST } = await import('./route')

    const response = await POST(createAuthorizeRequest({ action: 'approve', locale: 'es' }))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/mcp/authorize?status=invalid'
    )
    expect(mockApproveMcpDeviceLogin).not.toHaveBeenCalled()
    expect(mockCancelMcpDeviceLogin).not.toHaveBeenCalled()
  })

  it('rejects approval submissions without the rendered approval token', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createAuthorizeRequest({
        action: 'approve',
        code: 'login-code',
        locale: 'es',
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/mcp/authorize?status=invalid'
    )
    expect(mockApproveMcpDeviceLogin).not.toHaveBeenCalled()
    expect(mockCancelMcpDeviceLogin).not.toHaveBeenCalled()
  })

  it('rejects approval submissions from an untrusted origin', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createAuthorizeRequest(
        {
          action: 'approve',
          approvalToken: 'approval-token',
          code: 'login-code',
          locale: 'es',
        },
        { origin: 'https://attacker.example.test' }
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/mcp/authorize?status=invalid'
    )
    expect(mockApproveMcpDeviceLogin).not.toHaveBeenCalled()
    expect(mockCancelMcpDeviceLogin).not.toHaveBeenCalled()
  })
})
