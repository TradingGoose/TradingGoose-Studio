/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApproveConnectionLogin,
  mockCancelConnectionLogin,
  mockGetBaseUrl,
  mockGetSession,
  mockGetSessionCookie,
} = vi.hoisted(() => ({
  mockApproveConnectionLogin: vi.fn(),
  mockCancelConnectionLogin: vi.fn(),
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

vi.mock('@/lib/connect/auth', () => ({
  approveConnectionLogin: (...args: unknown[]) => mockApproveConnectionLogin(...args),
  cancelConnectionLogin: (...args: unknown[]) => mockCancelConnectionLogin(...args),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: (...args: unknown[]) => mockGetBaseUrl(...args),
}))

function createAuthorizeRequest(
  body: Record<string, string>,
  headers: Record<string, string> = {},
  origin = 'https://studio.example.test'
) {
  return new NextRequest(`${origin}/api/auth/connect/authorize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      ...headers,
    },
    body: new URLSearchParams(body),
  })
}

describe('connection authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBaseUrl.mockReturnValue('https://studio.example.test')
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetSessionCookie.mockReturnValue(null)
    mockApproveConnectionLogin.mockResolvedValue({
      status: 'approved',
      expiresAt: '2026-06-19T12:00:00.000Z',
    })
    mockCancelConnectionLogin.mockResolvedValue({ status: 'cancelled' })
  })

  it('approves a device login from an explicit submitted confirmation', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      createAuthorizeRequest(
        {
          action: 'approve',
          approvalToken: 'approval-token',
          code: 'login-code',
          locale: 'es',
        },
        { origin: 'https://studio.example.test' },
        'https://preview.example.test'
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/connect/mcp/authorize?status=approved'
    )
    expect(mockApproveConnectionLogin).toHaveBeenCalledWith({
      approvalToken: 'approval-token',
      code: 'login-code',
      userId: 'user-1',
    })
    expect(mockCancelConnectionLogin).not.toHaveBeenCalled()
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
      'https://studio.example.test/zh/connect/mcp/authorize?status=cancelled'
    )
    expect(mockCancelConnectionLogin).toHaveBeenCalledWith({
      approvalToken: 'approval-token',
      code: 'login-code',
      userId: 'user-1',
    })
    expect(mockApproveConnectionLogin).not.toHaveBeenCalled()
  })

  it('rejects malformed confirmation submissions before auth mutation', async () => {
    const { POST } = await import('./route')

    const response = await POST(createAuthorizeRequest({ action: 'approve', locale: 'es' }))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://studio.example.test/es/connect/mcp/authorize?status=invalid'
    )
    expect(mockApproveConnectionLogin).not.toHaveBeenCalled()
    expect(mockCancelConnectionLogin).not.toHaveBeenCalled()
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
      'https://studio.example.test/es/connect/mcp/authorize?status=invalid'
    )
    expect(mockApproveConnectionLogin).not.toHaveBeenCalled()
    expect(mockCancelConnectionLogin).not.toHaveBeenCalled()
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
      'https://studio.example.test/es/connect/mcp/authorize?status=invalid'
    )
    expect(mockApproveConnectionLogin).not.toHaveBeenCalled()
    expect(mockCancelConnectionLogin).not.toHaveBeenCalled()
  })
})
