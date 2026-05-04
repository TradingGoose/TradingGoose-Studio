import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSessionCookie = vi.fn()
const browserHeaders = {
  'user-agent': 'Mozilla/5.0',
}

function createRequest(url: string) {
  return new NextRequest(url, { headers: browserHeaders })
}

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
    mockGetSessionCookie.mockReturnValue(undefined)
  })

  it('uses the request host for localhost auth redirects instead of hosted-mode rewrites', async () => {
    mockGetSessionCookie.mockReturnValue(undefined)

    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('http://localhost:3000/workspace/ws-1/dashboard?layoutId=layout-1')
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
      createRequest('https://www.tradinggoose.ai/workspace/ws-1/dashboard')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard'
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('canonicalizes callbacks for default-locale protected routes', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('https://www.tradinggoose.ai/en/workspace/ws-1/dashboard')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/login?callbackUrl=%2Fworkspace%2Fws-1%2Fdashboard'
    )
  })

  it('rewrites locale-prefixed homepage requests to the root route', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(createRequest('https://www.tradinggoose.ai/es'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://www.tradinggoose.ai/')
    expect(response.headers.get('location')).toBeNull()
  })

  it('rewrites locale-prefixed blog requests to the unprefixed route', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(createRequest('https://www.tradinggoose.ai/es/blog'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://www.tradinggoose.ai/blog')
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects locale-prefixed English-only legal pages to the canonical unprefixed route', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(createRequest('https://www.tradinggoose.ai/es/privacy'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://www.tradinggoose.ai/privacy')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('redirects default-locale prefixed routes to the canonical unprefixed route', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(createRequest('https://www.tradinggoose.ai/en/blog'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://www.tradinggoose.ai/blog')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('preserves the locale when redirecting invitation accept requests', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('https://www.tradinggoose.ai/es/api/workspaces/invitations/accept?token=abc123')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/es/invite/abc123?token=abc123'
    )
  })

  it('preserves the locale when redirecting invitation accept requests for zh', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest(
        'https://www.tradinggoose.ai/zh/api/workspaces/invitations/accept?token=abc123'
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/zh/invite/abc123?token=abc123'
    )
  })

  it('rejects the old zh-CN public prefix', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(createRequest('https://www.tradinggoose.ai/zh-CN/blog'))

    expect(response.status).toBe(404)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
  })

  it('preserves the locale when redirecting a protected route to login', async () => {
    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('https://www.tradinggoose.ai/es/workspace/ws-1/dashboard')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.tradinggoose.ai/es/login?callbackUrl=%2Fes%2Fworkspace%2Fws-1%2Fdashboard'
    )
  })

  it('rewrites locale-prefixed protected routes to the unprefixed route when session exists', async () => {
    mockGetSessionCookie.mockReturnValue('active-session')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('https://www.tradinggoose.ai/es/workspace/ws-1/dashboard?layoutId=layout-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://www.tradinggoose.ai/workspace/ws-1/dashboard?layoutId=layout-1'
    )
    expect(response.headers.get('location')).toBeNull()
  })

  it('allows the login route through when reauth is explicitly requested', async () => {
    mockGetSessionCookie.mockReturnValue('stale-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest('http://localhost:3000/login?reauth=1&callbackUrl=%2Fworkspace%2Fws-1')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('better-auth.session_token')?.maxAge).toBe(0)
  })

  it('allows locale-prefixed login routes through when reauth is explicitly requested', async () => {
    mockGetSessionCookie.mockReturnValue('stale-cookie')

    const { proxy } = await import('./proxy')
    const response = await proxy(
      createRequest(
        'https://www.tradinggoose.ai/es/login?reauth=1&callbackUrl=%2Fes%2Fworkspace%2Fws-1'
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://www.tradinggoose.ai/login?reauth=1&callbackUrl=%2Fes%2Fworkspace%2Fws-1'
    )
    expect(response.cookies.get('better-auth.session_token')?.maxAge).toBe(0)
  })
})

describe('proxy matcher extraction', () => {
  const proxyFilePath = fileURLToPath(new URL('./proxy.ts', import.meta.url))
  const pageType = 'pages' as any
  const expectedMatchers = [
    '/',
    '/terms',
    '/privacy',
    '/workspace/:path*',
    '/login',
    '/signup',
    '/invite/:path*',
    '/((?!_next/static|_next/image|blog-images/|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ]

  it('recovers proxy matchers after SWC bindings are installed', async () => {
    const { getPageStaticInfo } = await import('next/dist/build/analysis/get-page-static-info.js')
    const { installBindings } = await import('next/dist/build/swc/install-bindings.js')

    await expect(
      getPageStaticInfo({
        pageType,
        nextConfig: {},
        pageFilePath: proxyFilePath,
        isDev: true,
        page: '/proxy',
      })
    ).rejects.toMatchObject({ __NEXT_ERROR_CODE: 'E907' })

    await installBindings()

    const staticInfo = await getPageStaticInfo({
      pageType,
      nextConfig: {},
      pageFilePath: proxyFilePath,
      isDev: true,
      page: '/proxy',
    })

    expect(staticInfo.middleware?.matchers?.map(({ originalSource }) => originalSource)).toEqual(
      expectedMatchers
    )
  })

  it('fails fast when a proxy file exports an empty matcher list', async () => {
    const { getPageStaticInfo } = await import('next/dist/build/analysis/get-page-static-info.js')
    const { installBindings } = await import('next/dist/build/swc/install-bindings.js')

    await installBindings()

    const tempDir = mkdtempSync(join(tmpdir(), 'tradinggoose-proxy-'))
    const tempFile = join(tempDir, 'proxy.ts')

    try {
      writeFileSync(
        tempFile,
        `export function proxy() {\n  return null\n}\n\nexport const config = {\n  matcher: [],\n}\n`
      )

      await expect(
        getPageStaticInfo({
          pageType,
          nextConfig: {},
          pageFilePath: tempFile,
          isDev: true,
          page: '/proxy',
        })
      ).rejects.toMatchObject({ __NEXT_ERROR_CODE: 'E1143' })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
