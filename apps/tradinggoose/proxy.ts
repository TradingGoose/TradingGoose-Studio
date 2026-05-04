import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { appendHomepageDiscoveryLinks } from '@/lib/discovery/link-headers'
import {
  appendVaryHeader,
  isMarkdownRenderablePath,
  MARKDOWN_BYPASS_HEADER,
  MARKDOWN_RENDER_ROUTE,
  requestAcceptsMarkdown,
} from '@/lib/markdown/negotiation'
import {
  defaultLocale,
  type LocaleCode,
  localizePathname,
  stripLocaleFromPathname,
} from '@/i18n/utils'
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Proxy')
const NEXT_INTL_LOCALE_HEADER = 'X-NEXT-INTL-LOCALE'

const AUTH_ROUTES = new Set(['/login', '/signup'])
const ENGLISH_ONLY_PUBLIC_ROUTES = new Set([
  '/privacy',
  '/terms',
  '/licenses',
  '/careers',
  '/changelog',
])
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
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
] as const

function createRequestHeaders(
  request: NextRequest,
  locale: LocaleCode,
  extraHeaders: Record<string, string> = {}
) {
  const headers = new Headers(request.headers)
  headers.set(NEXT_INTL_LOCALE_HEADER, locale)

  Object.entries(extraHeaders).forEach(([key, value]) => {
    headers.set(key, value)
  })

  return headers
}

function buildNormalizedUrl(request: NextRequest, pathname: string) {
  const normalizedUrl = new URL(pathname, request.url)
  normalizedUrl.search = request.nextUrl.search
  return normalizedUrl
}

function buildLocaleAwareResponse(
  request: NextRequest,
  locale: LocaleCode,
  pathname: string,
  extraRequestHeaders: Record<string, string> = {}
) {
  const hasLocalePrefix = pathname !== request.nextUrl.pathname
  const normalizedUrl = buildNormalizedUrl(request, pathname)

  if (hasLocalePrefix && locale === defaultLocale) {
    return NextResponse.redirect(normalizedUrl)
  }

  if (hasLocalePrefix) {
    return NextResponse.rewrite(normalizedUrl, {
      request: {
        headers: createRequestHeaders(request, locale, extraRequestHeaders),
      },
    })
  }

  return NextResponse.next({
    request: {
      headers: createRequestHeaders(request, locale, extraRequestHeaders),
    },
  })
}

function buildLoginRedirect(request: NextRequest, callback?: string) {
  const { locale } = stripLocaleFromPathname(request.nextUrl.pathname)
  const loginUrl = new URL(localizePathname(locale, '/login'), request.url)
  if (callback) {
    loginUrl.searchParams.set('callbackUrl', callback)
  }
  return NextResponse.redirect(loginUrl)
}

function isProtectedAppPath(pathname: string): boolean {
  const { pathname: normalizedPathname } = stripLocaleFromPathname(pathname)

  return (
    normalizedPathname.startsWith('/workspace') ||
    normalizedPathname === '/admin' ||
    normalizedPathname.startsWith('/admin/') ||
    normalizedPathname === '/workspace/'
  )
}

function isAuthRoute(pathname: string): boolean {
  const { pathname: normalizedPathname } = stripLocaleFromPathname(pathname)

  return AUTH_ROUTES.has(normalizedPathname)
}

function getLocalizedCallbackPath(pathname: string, search: string) {
  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(pathname)
  return `${localizePathname(locale, normalizedPathname)}${search}`
}

function isMarkdownRequestPath(pathname: string) {
  const { pathname: normalizedPathname } = stripLocaleFromPathname(pathname)

  return isMarkdownRenderablePath(normalizedPathname)
}

function getLocalizedWorkspacePath(pathname: string) {
  const { locale } = stripLocaleFromPathname(pathname)
  return localizePathname(locale, '/workspace')
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

  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(request.nextUrl.pathname)

  if (locale === defaultLocale && normalizedPathname !== request.nextUrl.pathname) {
    return NextResponse.redirect(buildNormalizedUrl(request, normalizedPathname))
  }

  const rewriteUrl = new URL(MARKDOWN_RENDER_ROUTE, request.url)
  rewriteUrl.searchParams.set('path', request.nextUrl.pathname)

  const requestHeaders = createRequestHeaders(request, locale, {
    [MARKDOWN_BYPASS_HEADER]: '1',
  })

  return NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders,
    },
  })
}

/**
 * Handles workspace invitation API endpoint access
 */
function handleWorkspaceInvitationAPI(
  request: NextRequest,
  hasActiveSession: boolean
): NextResponse | null {
  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(request.nextUrl.pathname)

  if (!normalizedPathname.startsWith('/api/workspaces/invitations')) {
    return null
  }

  if (normalizedPathname.includes('/accept') && !hasActiveSession) {
    const token = request.nextUrl.searchParams.get('token')
    if (token) {
      const inviteUrl = new URL(localizePathname(locale, `/invite/${token}`), request.url)
      inviteUrl.searchParams.set('token', token)
      return NextResponse.redirect(inviteUrl)
    }
  }

  return buildLocaleAwareResponse(request, locale, normalizedPathname)
}

/**
 * Handles security filtering for suspicious user agents
 */
function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const isWebhookEndpoint = request.nextUrl.pathname.startsWith('/api/webhooks/trigger/')
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  // Block suspicious requests, but exempt webhook endpoints from User-Agent validation
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

  if (url.pathname === '/zh-CN' || url.pathname.startsWith('/zh-CN/')) {
    return new NextResponse(null, { status: 404 })
  }

  const { locale, pathname: normalizedPathname } = stripLocaleFromPathname(url.pathname)

  const hasActiveSession = Boolean(getSessionCookie(request))
  const isProtectedPath = isProtectedAppPath(url.pathname)
  const reauth = url.searchParams.get('reauth') === '1'

  if (isProtectedPath) {
    if (!hasActiveSession) {
      const callbackTarget = getLocalizedCallbackPath(url.pathname, url.search)
      return buildLoginRedirect(request, callbackTarget)
    }
  }

  if (isAuthRoute(url.pathname)) {
    if (reauth) {
      const response = buildLocaleAwareResponse(request, locale, normalizedPathname)
      clearAuthCookies(response)
      return response
    }

    if (hasActiveSession) {
      return NextResponse.redirect(new URL(getLocalizedWorkspacePath(url.pathname), request.url))
    }
  }

  const workspaceInvitationRedirect = handleWorkspaceInvitationAPI(request, hasActiveSession)
  if (workspaceInvitationRedirect) return workspaceInvitationRedirect

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock

  if (ENGLISH_ONLY_PUBLIC_ROUTES.has(normalizedPathname) && normalizedPathname !== url.pathname) {
    return NextResponse.redirect(buildNormalizedUrl(request, normalizedPathname))
  }

  const markdownRewrite = rewriteMarkdownRequest(request)
  if (markdownRewrite) return markdownRewrite

  const requestHeaders: Record<string, string> = isProtectedPath
    ? { 'x-auth-callback-url': getLocalizedCallbackPath(url.pathname, url.search) }
    : {}

  const response = buildLocaleAwareResponse(request, locale, normalizedPathname, requestHeaders)

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
    '/', // Root path for self-hosted redirect logic
    '/terms', // Whitelabel terms redirect
    '/privacy', // Whitelabel privacy redirect
    '/workspace/:path*', // New workspace routes
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!_next/static|_next/image|blog-images/|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
