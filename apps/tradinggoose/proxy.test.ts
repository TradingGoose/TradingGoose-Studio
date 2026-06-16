import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSessionCookie = vi.fn()
const mockGetSession = vi.fn()
const mockSettingsLimit = vi.fn()
const mockDbSelect = vi.fn()

vi.mock('better-auth/cookies', () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
  settings: {
    preferredLocale: 'settings.preferredLocale',
    userId: 'settings.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}))

vi.mock('./lib/logs/console/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}))

vi.mock('./lib/security/csp', () => ({
  generateRuntimeCSP: vi.fn(async () => "default-src 'self'"),
}))

vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await vi.importActual<typeof import('next/server')>('next/server')
  const locales = ['en', 'es', 'zh'] as const

  return {
    default: () => (request: { nextUrl: URL; url: string }) => {
      const url = new URL(request.url)
      const firstSegment = url.pathname.split('/').filter(Boolean)[0]

      if (firstSegment && locales.includes(firstSegment as (typeof locales)[number])) {
        return NextResponse.next()
      }

      url.pathname = url.pathname === '/' ? '/en' : `/en${url.pathname}`
      return NextResponse.redirect(url)
    },
  }
})

describe('proxy auth routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetSessionCookie.mockReturnValue(undefined)
    mockGetSession.mockResolvedValue(null)
    mockSettingsLimit.mockResolvedValue([])
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: mockSettingsLimit,
        }),
      }),
    })
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
      'http://localhost:3000/en/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })

  it.each([
    ['root', 'http://localhost:3000/', 'http://localhost:3000/en'],
    ['privacy', 'http://localhost:3000/privacy', 'http://localhost:3000/en/privacy'],
    ['login', 'http://localhost:3000/login', 'http://localhost:3000/en/login'],
  ])(
    'redirects unprefixed %s routes to the default locale when no preference is present',
    async (_, url, location) => {
      mockGetSessionCookie.mockReturnValue(undefined)

      const { proxy } = await import('./proxy')
      const response = await proxy(
        new NextRequest(url, {
          headers: {
            'user-agent': 'vitest',
            accept: 'text/html',
          },
        })
      )

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(location)
      expect(response.headers.get('x-middleware-rewrite')).toBeNull()
      expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
    }
  )

  it.each([
    ['root', 'http://localhost:3000/?source=nav', 'http://localhost:3000/zh?source=nav'],
    ['privacy', 'http://localhost:3000/privacy', 'http://localhost:3000/zh/privacy'],
    ['login', 'http://localhost:3000/login', 'http://localhost:3000/zh/login'],
  ])('redirects anonymous unprefixed %s routes to the locale cookie', async (_, url, location) => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest(url, {
        headers: {
          cookie: 'NEXT_LOCALE=zh',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(location)
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('zh')
  })

  it('redirects anonymous unprefixed protected routes using Accept-Language', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/workspace/ws-1/dashboard', {
        headers: {
          'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/es/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard'
    )
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it('redirects hosted protected routes to login when no session is present', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('https://www.tradinggoose.ai/workspace/ws-1/dashboard')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/en/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('allows the default-locale reauth login route through while clearing cookies', async () => {
    mockGetSessionCookie.mockReturnValue('stale-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
    expect(response.cookies.get('better-auth.session_token')?.maxAge).toBe(0)
  })

  it('preserves locale on the login route while keeping callback targets canonical', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/workspace/ws-1/dashboard?layoutId=layout-1')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/es/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard%3FlayoutId%3Dlayout-1'
    )
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it('redirects authenticated localized auth routes to the localized workspace root', async () => {
    mockGetSessionCookie.mockReturnValue('session-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(new NextRequest('http://localhost:3000/es/login'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/es/workspace')
  })

  it('keeps default-locale prefixed routes canonical', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/login', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })

  it('lets next-intl handle localized landing routes canonically', async () => {
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
    expect(response.headers.get('x-middleware-rewrite')).not.toBe('http://localhost:3000/')
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it.each([
    ['root', 'http://localhost:3000/?source=nav', 'http://localhost:3000/zh?source=nav'],
    ['workspace', 'http://localhost:3000/workspace', 'http://localhost:3000/zh/workspace'],
    ['prefixed workspace', 'http://localhost:3000/en/workspace', 'http://localhost:3000/zh/workspace'],
  ])(
    'redirects authenticated %s requests to the stored user locale',
    async (_, url, location) => {
      mockGetSessionCookie.mockReturnValue('session-cookie')
      mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
      mockSettingsLimit.mockResolvedValue([{ preferredLocale: 'zh' }])

      const { proxy } = await import('./proxy')
      const response = await proxy(
        new NextRequest(url, {
          headers: {
            cookie: 'NEXT_LOCALE=es',
            'user-agent': 'vitest',
          },
        })
      )

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(location)
      expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('zh')
    }
  )

  it('does not rewrite localized API-shaped paths to canonical API routes', async () => {
    mockGetSessionCookie.mockReturnValue('session-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest(
        'http://localhost:3000/es/api/workspaces/invitations/invitation-1?token=abc',
        {
          headers: {
            'user-agent': 'vitest',
          },
        }
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).not.toBe(
      'http://localhost:3000/api/workspaces/invitations/invitation-1?token=abc'
    )
  })

  it('exempts canonical webhook trigger API requests from suspicious user-agent filtering', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/webhooks/trigger/webhook-1', {
        headers: {
          'user-agent': 'sqlmap',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('does not exempt localized API-shaped webhook paths from suspicious user-agent filtering', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/api/webhooks/trigger/webhook-1', {
        headers: {
          'user-agent': 'sqlmap',
        },
      })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('rewrites default-locale markdown requests with the normalized content path', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/terms', {
        headers: {
          accept: 'text/markdown',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/api/markdown?path=%2Fterms&locale=en'
    )
  })
})
