import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { appendHomepageDiscoveryLinks } from '@/lib/discovery/link-headers'
import {
  appendVaryHeader,
  isMarkdownRenderablePath,
  MARKDOWN_BYPASS_HEADER,
  MARKDOWN_RENDER_ROUTE,
  requestAcceptsMarkdown,
} from '@/lib/markdown/negotiation'
import { routing } from '@/i18n/routing'
import {
  defaultLocale,
  isLocaleCode,
  type LocaleCode,
  localizeUrl,
  stripLocaleFromPathname,
} from '@/i18n/utils'
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Proxy')
const handleI18nRouting = createMiddleware(routing)
const LOCALE_COOKIE = 'NEXT_LOCALE'

const AUTH_ROUTES = new Set(['/login', '/signup'])
const AUTH_COOKIE_KEYS = [
  'better-auth.session_token',
  'better-auth.session_data',
  'better-auth.dont_remember',
  '__Secure-better-auth.session_token',
  '__Secure-better-auth.session_data',
  '__Secure-better-auth.dont_remember',
]

function clearAuthCookies(response: NextResponse) {
  AUTH_COOKIE_KEYS.forEach((name) => {
    response.cookies.set({
      name,
      value: '',
      maxAge: 0,
      path: '/',
    })
  })
}

const SUSPICIOUS_UA_PATTERNS = [
  /^\s*$/,
  /\.\./,
  /<\s*script/i,
  /^\(\)\s*{/,
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i,
] as const

interface LocaleRoute {
  locale: LocaleCode
  pathname: string
  hasLocalePrefix: boolean
}

function resolveLocaleRoute(pathname: string): LocaleRoute {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(pathname)
  return {
    locale,
    pathname: normalizedPathname,
    hasLocalePrefix: Boolean(firstSegment && isLocaleCode(firstSegment)),
  }
}

function buildNormalizedUrl(request: NextRequest, pathname: string) {
  const normalizedUrl = new URL(pathname, request.url)
  normalizedUrl.search = request.nextUrl.search
  return normalizedUrl
}

function isCanonicalRouteHandlerPath(pathname: string) {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/ingest' ||
    pathname.startsWith('/ingest/') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/blog-images/') ||
    pathname.startsWith('/monaco-editor/') ||
    pathname === '/changelog.xml' ||
    pathname === '/llms.txt' ||
    pathname === '/llms-full.txt' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  )
}

function buildLoginRedirect(request: NextRequest, callback?: string) {
  const { locale } = resolveLocaleRoute(request.nextUrl.pathname)
  const loginUrl = new URL(localizeUrl(request.nextUrl.origin, locale, '/login'))

  if (callback) {
    loginUrl.searchParams.set('callbackUrl', callback)
  }

  return NextResponse.redirect(loginUrl)
}

function isProtectedAppPath(pathname: string): boolean {
  const { pathname: normalizedPathname } = resolveLocaleRoute(pathname)

  return (
    normalizedPathname.startsWith('/workspace') ||
    normalizedPathname === '/admin' ||
    normalizedPathname.startsWith('/admin/') ||
    normalizedPathname === '/workspace/'
  )
}

function isAuthRoute(pathname: string): boolean {
  const { pathname: normalizedPathname } = resolveLocaleRoute(pathname)
  return AUTH_ROUTES.has(normalizedPathname)
}

function getCanonicalCallbackPath(pathname: string, search: string) {
  const { pathname: normalizedPathname } = resolveLocaleRoute(pathname)
  return `${normalizedPathname}${search}`
}

function isMarkdownRequestPath(pathname: string) {
  const { pathname: normalizedPathname } = resolveLocaleRoute(pathname)
  return isMarkdownRenderablePath(normalizedPathname)
}

function rewriteMarkdownRequest(request: NextRequest): NextResponse | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null
  }

  if (request.headers.get(MARKDOWN_BYPASS_HEADER) === '1') {
    return null
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return null
  }

  if (!requestAcceptsMarkdown(request.headers)) {
    return null
  }

  if (!isMarkdownRequestPath(request.nextUrl.pathname)) {
    return null
  }

  const route = resolveLocaleRoute(request.nextUrl.pathname)
  const { locale, pathname: normalizedPathname } = route

  if (route.hasLocalePrefix && locale === defaultLocale) {
    return NextResponse.redirect(buildNormalizedUrl(request, normalizedPathname))
  }

  const rewriteUrl = new URL(MARKDOWN_RENDER_ROUTE, request.url)
  rewriteUrl.searchParams.set('path', normalizedPathname)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(MARKDOWN_BYPASS_HEADER, '1')

  return NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders,
    },
  })
}

function redirectRootToPreferredLocale(request: NextRequest): NextResponse | null {
  const preferredLocale = request.cookies.get(LOCALE_COOKIE)?.value

  if (
    request.nextUrl.pathname !== '/' ||
    !preferredLocale ||
    !isLocaleCode(preferredLocale) ||
    preferredLocale === defaultLocale
  ) {
    return null
  }

  const redirectUrl = new URL(localizeUrl(request.nextUrl.origin, preferredLocale, '/'))
  redirectUrl.search = request.nextUrl.search
  return NextResponse.redirect(redirectUrl)
}

function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const isWebhookEndpoint = request.nextUrl.pathname.startsWith('/api/webhooks/trigger/')
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  if (isSuspicious && !isWebhookEndpoint) {
    logger.warn('Blocked suspicious request', {
      userAgent,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      url: request.url,
      method: request.method,
      pattern: SUSPICIOUS_UA_PATTERNS.find((pattern) => pattern.test(userAgent))?.toString(),
    })

    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  }

  return null
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl
  const route = resolveLocaleRoute(url.pathname)
  const { locale, pathname: normalizedPathname } = route

  const hasActiveSession = Boolean(getSessionCookie(request))
  const isProtectedPath = isProtectedAppPath(url.pathname)
  const reauth = url.searchParams.get('reauth') === '1'

  if (isProtectedPath && !hasActiveSession) {
    const callbackTarget = getCanonicalCallbackPath(url.pathname, url.search)
    return buildLoginRedirect(request, callbackTarget)
  }

  if (isAuthRoute(url.pathname)) {
    if (reauth) {
      const response = handleI18nRouting(request)
      clearAuthCookies(response)
      return response
    }

    if (hasActiveSession) {
      return NextResponse.redirect(new URL(localizeUrl(url.origin, locale, '/workspace')))
    }
  }

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock

  const markdownRewrite = rewriteMarkdownRequest(request)
  if (markdownRewrite) return markdownRewrite

  const localeRedirect = redirectRootToPreferredLocale(request)
  if (localeRedirect) return localeRedirect

  const response = isCanonicalRouteHandlerPath(url.pathname)
    ? NextResponse.next()
    : handleI18nRouting(request)

  if (response.headers.has('location')) {
    return response
  }

  response.headers.set('Vary', appendVaryHeader(appendVaryHeader(null, 'User-Agent'), 'Accept'))

  if (
    normalizedPathname.startsWith('/workspace') ||
    normalizedPathname.startsWith('/chat') ||
    normalizedPathname === '/'
  ) {
    response.headers.set('Content-Security-Policy', await generateRuntimeCSP())
  }

  if (normalizedPathname === '/') {
    appendHomepageDiscoveryLinks(response.headers, locale)
  }

  return response
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api|_next|_vercel|ingest|blog-images|monaco-editor|favicon|logo|static|footer|social|enterprise|twitter|.*\\..*).*)',
  ],
}
