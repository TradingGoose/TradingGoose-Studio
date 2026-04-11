/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthHandler,
  mockLoadSystemOAuthClientCredentials,
  mockRunWithSystemOAuthClientCredentials,
  mockToNextJsHandler,
} = vi.hoisted(() => ({
  mockAuthHandler: vi.fn(),
  mockLoadSystemOAuthClientCredentials: vi.fn(),
  mockRunWithSystemOAuthClientCredentials: vi.fn(),
  mockToNextJsHandler: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (...args: unknown[]) => mockToNextJsHandler(...args),
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

describe('auth catch-all route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockToNextJsHandler.mockImplementation((handler: (request: Request) => Promise<Response>) => ({
      GET: handler,
      POST: handler,
    }))
    mockRunWithSystemOAuthClientCredentials.mockImplementation(
      async (callback: () => Promise<Response>, _credentials: Record<string, unknown>) => callback()
    )
    mockAuthHandler.mockResolvedValue(Response.json({ ok: true }))
  })

  it('hydrates credentials for social sign-in requests', async () => {
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      github: {
        clientId: 'github-db-client-id',
        clientSecret: 'github-db-client-secret',
        fields: {
          client_id: 'github-db-client-id',
          client_secret: 'github-db-client-secret',
        },
      },
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost:3000/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'github',
        callbackURL: '/workspace',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['github'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        github: expect.objectContaining({
          clientId: 'github-db-client-id',
        }),
      })
    )
    expect(mockAuthHandler).toHaveBeenCalledWith(request)
  })

  it('hydrates credentials for social callback requests', async () => {
    mockLoadSystemOAuthClientCredentials.mockResolvedValue({
      google: {
        clientId: 'google-db-client-id',
        clientSecret: 'google-db-client-secret',
        fields: {
          client_id: 'google-db-client-id',
          client_secret: 'google-db-client-secret',
        },
      },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost:3000/api/auth/callback/google?code=test&state=state',
      {
        method: 'GET',
      }
    )

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockLoadSystemOAuthClientCredentials).toHaveBeenCalledWith(['google'])
    expect(mockRunWithSystemOAuthClientCredentials).toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledWith(request)
  })

  it('does not hydrate credentials for sso callbacks', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost:3000/api/auth/sso/callback/acme-sso', {
      method: 'POST',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockLoadSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockRunWithSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledWith(request)
  })

  it('passes through non-oauth auth routes without hydrating credentials', async () => {
    const { GET } = await import('./route')
    const request = new Request('http://localhost:3000/api/auth/session', {
      method: 'GET',
    })

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockLoadSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockRunWithSystemOAuthClientCredentials).not.toHaveBeenCalled()
    expect(mockAuthHandler).toHaveBeenCalledWith(request)
  })
})
