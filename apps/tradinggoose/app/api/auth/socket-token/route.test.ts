/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateOneTimeToken, mockGetSession, mockHeaders } = vi.hoisted(() => ({
  mockGenerateOneTimeToken: vi.fn(),
  mockGetSession: vi.fn(),
  mockHeaders: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      generateOneTimeToken: (...args: unknown[]) => mockGenerateOneTimeToken(...args),
    },
  },
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

describe('socket token route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockHeaders.mockResolvedValue(new Headers([['cookie', 'better-auth.session_token=token']]))
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGenerateOneTimeToken.mockResolvedValue({ token: 'socket-token' })
  })

  it('uses the canonical app session before issuing a socket token', async () => {
    const { POST } = await import('./route')

    const response = await POST()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: 'socket-token' })
    expect(mockGetSession).toHaveBeenCalledWith(expect.any(Headers))
    expect(mockGenerateOneTimeToken).toHaveBeenCalledWith({ headers: expect.any(Headers) })
  })

  it('rejects socket token requests without an app session', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('./route')
    const response = await POST()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
    expect(mockGenerateOneTimeToken).not.toHaveBeenCalled()
  })
})
