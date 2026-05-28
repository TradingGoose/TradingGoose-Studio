import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSessionCookie = vi.fn()

vi.mock('better-auth/cookies', () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}))

vi.mock('./lib/logs/console/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}))

vi.mock('./lib/security/csp', () => ({
  generateRuntimeCSP: vi.fn(async () => "default-src 'self'"),
}))

describe('proxy auth routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.tradinggoose.ai'
  })

  it('uses the request host for localhost auth redirects instead of hosted-mode rewrites', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/workspace/ws-1/dashboard?layoutId=layout-1')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('redirects hosted protected routes to login when no session is present', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('https://www.tradinggoose.ai/workspace/ws-1/dashboard')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('allows the login route through when reauth is explicitly requested', async () => {
    mockGetSessionCookie.mockReturnValue('stale-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('better-auth.session_token')?.maxAge).toBe(0)
  })

  it('preserves locale when redirecting localized protected routes to login', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/workspace/ws-1/dashboard?layoutId=layout-1')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/es/login?callbackUrl=%2Fes%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
  })

  it('redirects authenticated localized auth routes to the localized workspace root', async () => {
    mockGetSessionCookie.mockReturnValue('session-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(new NextRequest('http://localhost:3000/es/login'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/es/workspace')
  })

  it('normalizes default-locale prefixed routes before rendering', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/login', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('rewrites localized landing routes to the canonical internal page', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:3000/')
  })

  it('rewrites localized workspace invitation API requests to the unlocalized API path', async () => {
    mockGetSessionCookie.mockReturnValue('session-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/api/workspaces/invitations/invitation-1?token=abc')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/api/workspaces/invitations/invitation-1?token=abc'
    )
  })

  it('redirects unauthenticated localized invitation accept API requests to invite UI', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest(
        'http://localhost:3000/zh/api/workspaces/invitations/invitation-1/accept?token=abc'
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/zh/invite/abc?token=abc')
  })

  it('rewrites localized markdown requests with the normalized content path', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/terms', {
        headers: {
          accept: 'text/markdown',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/api/markdown?path=%2Fterms'
    )
  })
})
