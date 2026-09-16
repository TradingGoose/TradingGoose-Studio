import { describe, expect, it } from 'bun:test'
import { getDocsPathname, getLocalizedDocsHref, i18n, isDocsPath } from '../../apps/docs/lib/i18n'
import { getRequestLocale } from '../../apps/docs/lib/locale-request'
import { loader } from '../../apps/docs/node_modules/fumadocs-core/dist/source/index.js'
import { NextRequest } from '../../apps/docs/node_modules/next/server'
import { proxy } from '../../apps/docs/proxy'

const origin = 'https://docs.tradinggoose.ai'

function request(path: string, cookie?: string, language?: string) {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie)
  if (language) headers.set('Accept-Language', language)
  return new NextRequest(`${origin}${path}`, { headers })
}

describe('URL-selected documentation locale', () => {
  it.each(['en', 'es', 'zh'])('uses explicit %s over saved and browser languages', (locale) => {
    expect(getRequestLocale(request(`/${locale}/tools/github`, 'FD_LOCALE=es', 'zh-CN'))).toBe(
      locale
    )
  })

  it('uses an explicit API locale over the saved preference, validating it first', () => {
    const req = request('/api/search', 'FD_LOCALE=zh', 'en-US')
    expect(getRequestLocale(req, 'es')).toBe('es')
    expect(getRequestLocale(req, 'invalid')).toBe('zh')
    expect(getRequestLocale(request('/en', 'FD_LOCALE=zh'), 'es')).toBe('en')
  })

  it.each(['en', 'es', 'zh'])('uses saved %s over the browser language', (locale) => {
    expect(getRequestLocale(request('/', `FD_LOCALE=${locale}`, 'es-MX,zh;q=0.8'))).toBe(locale)
  })

  it.each([
    ['es-MX,en;q=0.5', 'es'],
    ['zh-Hant-HK,en;q=0.5', 'zh'],
    ['fr-CA,zh-CN;q=0.7,es;q=0.8', 'es'],
    ['es;q=0,zh;q=1', 'zh'],
    ['fr-CA', 'en'],
    ['', 'en'],
  ])('negotiates supported language from %s', (language, expected) => {
    expect(getRequestLocale(request('/', undefined, language))).toBe(expected)
  })

  it.each(['fr', '../../elsewhere', 'https://evil.example', 'undefined', ''])(
    'ignores invalid saved locale %s',
    (value) => {
      expect(getRequestLocale(request('/', `FD_LOCALE=${value}`, 'zh-CN'))).toBe('zh')
    }
  )

  it.each(['/', '/tools/github', '/copilot/copilot-mcp?install=1', '/apiary'])(
    'redirects unprefixed %s to the saved language',
    (path) => {
      const response = proxy(request(path, 'FD_LOCALE=es', 'en-US'))
      expect(response.status).toBe(307)
      expect(response.headers.has('x-middleware-rewrite')).toBe(false)
      expect(response.headers.get('Location')).toBe(`${origin}/es${path === '/' ? '' : path}`)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Content-Language')).toBe('es')
      expect(response.headers.get('Vary')).toBe('Cookie, Accept-Language')
      expect(response.headers.has('Set-Cookie')).toBe(false)
    }
  )

  it.each([
    ['/en', 'en'],
    ['/es?x=1', 'es'],
    ['/zh/tools/github?x=1', 'zh'],
  ])('keeps explicit %s canonical regardless of the saved language', (path, locale) => {
    const response = proxy(request(path, 'FD_LOCALE=zh'))
    expect(response.status).toBe(200)
    expect(response.headers.has('Location')).toBe(false)
    expect(response.headers.has('x-middleware-rewrite')).toBe(false)
    expect(response.headers.get('Content-Language')).toBe(locale)
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })

  it('never lets a speculative request replace the saved preference', () => {
    const req = request('/es/tools/github', 'FD_LOCALE=zh')
    req.headers.set('next-router-prefetch', '1')
    req.headers.set('Purpose', 'prefetch')
    expect(proxy(req).headers.has('Set-Cookie')).toBe(false)
    expect(proxy(request('/', undefined, 'es')).headers.has('Set-Cookie')).toBe(false)
  })

  it.each([
    '/api/search',
    '/_next/static/chunk.js',
    '/_next/image',
    '/static/logo.png',
    '/favicon/site.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/llms-full.txt',
    '/llms.mdx/tools/github',
    '/og-image.png',
  ])('leaves infrastructure endpoint %s untouched', (path) => {
    expect(isDocsPath(path)).toBe(false)
    const response = proxy(request(path, 'FD_LOCALE=zh'))
    expect(response.headers.has('x-middleware-rewrite')).toBe(false)
    expect(response.headers.has('Location')).toBe(false)
    expect(response.headers.has('Set-Cookie')).toBe(false)
  })
})

describe('localized links without English content fallback', () => {
  it.each([
    ['/en', '/'],
    ['/es/blocks', '/blocks'],
    ['/zh/tools/github', '/tools/github'],
    ['/', '/'],
    ['/blocks', '/blocks'],
    ['/english', '/english'],
  ])('strips %s only when explicitly constructing a language-switch target', (internal, raw) => {
    expect(getDocsPathname(internal)).toBe(raw)
    expect(getDocsPathname(raw)).toBe(raw)
  })

  it.each([
    ['/', '/es'],
    ['/?q=1#top', '/es?q=1#top'],
    ['/copilot?file=a.json#installation', '/es/copilot?file=a.json#installation'],
    ['/tools/github', '/es/tools/github'],
    ['/en', '/en'],
    ['/zh/tools/github?x=1#api', '/zh/tools/github?x=1#api'],
    ['/en?x=1', '/en?x=1'],
    ['/static/logo.png', '/static/logo.png'],
    ['/api/search?query=a', '/api/search?query=a'],
    ['/llms.mdx/es/tools/github', '/llms.mdx/es/tools/github'],
    ['#installation', '#installation'],
    ['?tab=one', '?tab=one'],
    ['../copilot', '../copilot'],
    ['https://example.com/page', 'https://example.com/page'],
    ['//example.com/page', '//example.com/page'],
    ['mailto:hello@example.com', 'mailto:hello@example.com'],
  ])('localizes %s while preserving explicit locales and non-document links', (href, expected) => {
    expect(getLocalizedDocsHref(href, 'es')).toBe(expected)
  })

  const source = loader({
    baseUrl: '/',
    i18n,
    source: {
      files: [
        ...i18n.languages.flatMap((locale) => [
          { type: 'page' as const, path: `${locale}/index.mdx`, data: { title: locale } },
          { type: 'page' as const, path: `${locale}/tools/github.mdx`, data: { title: locale } },
        ]),
        { type: 'page', path: 'en/english-only.mdx', data: { title: 'English only' } },
      ],
    },
  })

  it.each(i18n.languages)('prefixes all %s URLs and keeps content language-specific', (locale) => {
    expect(source.getPage([], locale)?.url).toBe(`/${locale}`)
    expect(source.getPage(['tools', 'github'], locale)?.url).toBe(`/${locale}/tools/github`)
    expect(source.getPage(['tools', 'github'], locale)?.data.title).toBe(locale)
  })

  it('retains all locale targets without silently substituting English pages', () => {
    expect(i18n.languages).toEqual(['en', 'es', 'zh'])
    expect(source.getPage(['english-only'], 'es')).toBeUndefined()
    expect(source.getPage(['english-only'], 'zh')).toBeUndefined()
  })
})
