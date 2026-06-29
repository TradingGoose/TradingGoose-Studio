import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.tradinggoose.ai'
  })

  it('uses the request host for protected route locale redirects', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/workspace/ws-1/dashboard?layoutId=layout-1', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/workspace/ws-1/dashboard?layoutId=layout-1'
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

  it('localizes unprefixed protected routes using Accept-Language', async () => {
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
      'http://localhost:3000/es/workspace/ws-1/dashboard'
    )
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it('localizes hosted protected routes before the app auth boundary handles access', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('https://www.tradinggoose.ai/workspace/ws-1/dashboard', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/en/workspace/ws-1/dashboard'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('lets the default-locale reauth login route reach its page boundary', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })

  it('keeps localized protected routes at the app auth boundary with a canonical callback header', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/es/workspace/ws-1/dashboard?layoutId=layout-1', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-request-x-tradinggoose-callback-path')).toBe(
      '/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it.each([
    '/es/login',
    '/es/signup',
    '/es/waitlist',
    '/es/reset-password',
    '/es/verify',
    '/es/sso',
    '/es/error',
  ])('lets auth route %s reach its page boundary', async (pathname) => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest(`http://localhost:3000${pathname}`, {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it('keeps default-locale prefixed routes canonical', async () => {
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
    ['root', 'http://localhost:3000/?source=nav', 'http://localhost:3000/es?source=nav'],
    ['workspace', 'http://localhost:3000/workspace', 'http://localhost:3000/es/workspace'],
  ])('redirects locale-cookie %s requests to the request locale', async (_, url, location) => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

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
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('es')
  })

  it('keeps locale-cookie prefixed requests canonical to the URL locale', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/en/workspace', {
        headers: {
          cookie: 'NEXT_LOCALE=zh',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })

  it('rewrites POST protected requests with the canonical callback header', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/workspace/ws-1/dashboard?layoutId=layout-1', {
        method: 'POST',
        headers: {
          cookie: 'NEXT_LOCALE=es',
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/es/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(response.headers.get('x-middleware-request-x-tradinggoose-callback-path')).toBe(
      '/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).toContain(
      'x-tradinggoose-callback-path'
    )
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('does not rewrite localized API-shaped paths to canonical API routes', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

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
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('exempts Codex MCP requests with an empty user-agent from suspicious user-agent filtering', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/copilot/mcp', {
        method: 'POST',
        headers: {
          'user-agent': '',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('does not exempt Codex MCP requests from non-empty suspicious user-agent filtering', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/copilot/mcp', {
        method: 'POST',
        headers: {
          'user-agent': 'sqlmap',
        },
      })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('keeps the MCP script route canonical for curl clients', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/mcp', {
        headers: {
          'user-agent': 'curl/8.0',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('keeps target-specific MCP setup script routes canonical for curl clients', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/mcp/setup/codex', {
        headers: {
          'user-agent': 'curl/8.0',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('localizes the MCP browser authorization page instead of treating it as a script route', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      new NextRequest('http://localhost:3000/mcp/authorize?code=login-code', {
        headers: {
          'user-agent': 'vitest',
        },
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/mcp/authorize?code=login-code'
    )
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })

  it('does not exempt localized API-shaped webhook paths from suspicious user-agent filtering', async () => {
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
