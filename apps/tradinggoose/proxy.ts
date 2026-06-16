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
  CANONICAL_CALLBACK_PATH_HEADER,
  defaultLocale,
  isLocaleCode,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type LocaleCode,
  localizeUrl,
  stripLocaleFromPathname,
} from '@/i18n/utils'
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Proxy')
const handleI18nRouting = createMiddleware(routing)

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

type AcceptLanguageCandidate = {
  locale: LocaleCode
  quality: number
  index: number
}

function resolveLocaleRoute(pathname: string, localeOverride?: LocaleCode): LocaleRoute {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(pathname)
  const hasLocalePrefix = Boolean(firstSegment && isLocaleCode(firstSegment))
  return {
    locale: hasLocalePrefix ? locale : (localeOverride ?? locale),
    pathname: normalizedPathname,
    hasLocalePrefix,
  }
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

function getLocaleCookie(request: NextRequest): LocaleCode | null {
  const locale = request.cookies.get(LOCALE_COOKIE)?.value
  return locale && isLocaleCode(locale) ? locale : null
}

function getAcceptLanguageLocale(header: string | null): LocaleCode | null {
  if (!header) {
    return null
  }

  const candidates: AcceptLanguageCandidate[] = []

  header.split(',').forEach((entry, index) => {
    const [rawLanguageRange, ...rawParams] = entry
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)

    if (!rawLanguageRange || rawLanguageRange === '*') {
      return
    }

    const locale = rawLanguageRange.toLowerCase().split('-', 1)[0]
    if (!isLocaleCode(locale)) {
      return
    }

    const qualityParam = rawParams.find((param) => param.toLowerCase().startsWith('q='))
    const quality = qualityParam ? Number.parseFloat(qualityParam.slice(2)) : 1
    if (!Number.isFinite(quality) || quality <= 0) {
      return
    }

    candidates.push({ locale, quality, index })
  })

  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return candidates[0]?.locale ?? null
}

function resolveRequestLocale(request: NextRequest): LocaleCode {
  return (
    getLocaleCookie(request) ??
    getAcceptLanguageLocale(request.headers.get('accept-language')) ??
    defaultLocale
  )
}

function buildLoginRedirect(request: NextRequest, route: LocaleRoute, callback?: string) {
  const { locale } = route
  const loginUrl = new URL(localizeUrl(request.nextUrl.origin, locale, '/login'))

  if (callback) {
    loginUrl.searchParams.set('callbackUrl', callback)
  }

  return withLocaleCookie(NextResponse.redirect(loginUrl), locale)
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

  const rewriteUrl = new URL(MARKDOWN_RENDER_ROUTE, request.url)
  rewriteUrl.searchParams.set('path', normalizedPathname)
  rewriteUrl.searchParams.set('locale', locale)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(MARKDOWN_BYPASS_HEADER, '1')

  return NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders,
    },
  })
}

function withLocaleCookie(response: NextResponse, locale: LocaleCode) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  })
  return response
}

function resolveCanonicalLocaleRoute(request: NextRequest, route: LocaleRoute): LocaleRoute {
  if (isCanonicalRouteHandlerPath(request.nextUrl.pathname)) {
    return route
  }

  if (route.hasLocalePrefix) {
    return route
  }

  return { ...route, locale: resolveRequestLocale(request) }
}

function routeToCanonicalLocale(request: NextRequest, route: LocaleRoute): NextResponse | null {
  if (isCanonicalRouteHandlerPath(request.nextUrl.pathname)) {
    return null
  }

  const requestRoute = resolveLocaleRoute(request.nextUrl.pathname)
  if (route.hasLocalePrefix && requestRoute.locale === route.locale) {
    return null
  }

  const targetUrl = new URL(localizeUrl(request.nextUrl.origin, route.locale, route.pathname))
  targetUrl.search = request.nextUrl.search

  if (request.method === 'GET' || request.method === 'HEAD') {
    return withLocaleCookie(NextResponse.redirect(targetUrl), route.locale)
  }

  return NextResponse.rewrite(targetUrl)
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
  const initialRoute = resolveLocaleRoute(url.pathname)
  const hasActiveSession = Boolean(getSessionCookie(request))
  const route = resolveCanonicalLocaleRoute(request, initialRoute)
  const { locale, pathname: normalizedPathname } = route

  const isProtectedPath = isProtectedAppPath(url.pathname)
  const reauth = url.searchParams.get('reauth') === '1'

  if (isProtectedPath && !hasActiveSession) {
    const callbackTarget = getCanonicalCallbackPath(url.pathname, url.search)
    return buildLoginRedirect(request, route, callbackTarget)
  }

  if (isAuthRoute(url.pathname)) {
    if (reauth) {
      const localeResponse = routeToCanonicalLocale(request, route)
      if (localeResponse) {
        clearAuthCookies(localeResponse)
        return localeResponse
      }

      const response = handleI18nRouting(request)
      clearAuthCookies(response)
      return withLocaleCookie(response, locale)
    }

    if (hasActiveSession) {
      return withLocaleCookie(
        NextResponse.redirect(new URL(localizeUrl(url.origin, locale, '/workspace'))),
        locale
      )
    }
  }

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock

  const localeResponse = routeToCanonicalLocale(request, route)
  if (localeResponse) return localeResponse

  const markdownRewrite = rewriteMarkdownRequest(request)
  if (markdownRewrite) return markdownRewrite

  const response = isCanonicalRouteHandlerPath(url.pathname)
    ? NextResponse.next()
    : handleI18nRouting(request)

  if (response.headers.has('location')) {
    return response
  }

  if (isProtectedPath) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set(
      CANONICAL_CALLBACK_PATH_HEADER,
      getCanonicalCallbackPath(url.pathname, url.search)
    )
    NextResponse.next({ request: { headers: requestHeaders } }).headers.forEach((value, key) => {
      response.headers.set(key, value)
    })
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

  return isCanonicalRouteHandlerPath(url.pathname) ? response : withLocaleCookie(response, locale)
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api|_next|_vercel|ingest|blog-images|monaco-editor|favicon|logo|static|footer|social|enterprise|twitter|.*\\..*).*)',
  ],
}
