/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthHandler,
  mockLoadSystemOAuthClientCredentials,
  mockRunWithSystemOAuthClientCredentials,
} = vi.hoisted(() => ({
  mockAuthHandler: vi.fn(),
  mockLoadSystemOAuthClientCredentials: vi.fn(),
  mockRunWithSystemOAuthClientCredentials: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (handler: (request: Request) => Promise<Response>) => ({
    GET: handler,
    POST: handler,
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    handler: (...args: unknown[]) => mockAuthHandler(...args),
  },
}))

vi.mock('@/lib/oauth/system-managed-config', () => ({
  loadSystemOAuthClientCredentials: (...args: unknown[]) =>
    mockLoadSystemOAuthClientCredentials(...args),
  runWithSystemOAuthClientCredentials: (...args: unknown[]) =>
    mockRunWithSystemOAuthClientCredentials(...args),
}))

describe('/api/auth/[...all] route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({})
    mockRunWithSystemOAuthClientCredentials.mockImplementation(async (callback: () => Response) =>
      callback()
    )
  })

  it('delegates non-system-oauth routes directly to Better Auth', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/sign-in/sso', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('hydrates configured system oauth credentials before delegating callback routes', async () => {
    mockAuthHandler.mockResolvedValue(new Response(null, { status: 204 }))
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      github: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    })

    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/github', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(204)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['github'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalledTimes(1)
    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when a system oauth callback provider is not configured', async () => {
    const { handleAuthRequest } = await import('./route')
    const response = await handleAuthRequest(
      new Request('http://localhost/api/auth/oauth2/callback/github', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'OAuth provider is not configured',
    })
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })
})
