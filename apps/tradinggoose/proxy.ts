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
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Proxy')

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
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
] as const

function buildLoginRedirect(request: NextRequest, callback?: string) {
  const loginUrl = new URL('/login', request.url)
  if (callback) {
    loginUrl.searchParams.set('callbackUrl', callback)
  }
  return NextResponse.redirect(loginUrl)
}

function isProtectedAppPath(pathname: string): boolean {
  return (
    pathname.startsWith('/workspace') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/workspace/'
  )
}

function rewriteMarkdownRequest(request: NextRequest): NextResponse | null {
  if (request.method !== 'GET') {
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

  if (!isMarkdownRenderablePath(request.nextUrl.pathname)) {
    return null
  }

  const rewriteUrl = new URL(MARKDOWN_RENDER_ROUTE, request.url)
  rewriteUrl.searchParams.set('path', request.nextUrl.pathname)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(MARKDOWN_BYPASS_HEADER, '1')

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
  if (!request.nextUrl.pathname.startsWith('/api/workspaces/invitations')) {
    return null
  }

  if (request.nextUrl.pathname.includes('/accept') && !hasActiveSession) {
    const token = request.nextUrl.searchParams.get('token')
    if (token) {
      return NextResponse.redirect(new URL(`/invite/${token}?token=${token}`, request.url))
    }
  }
  return NextResponse.next()
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

  const hasActiveSession = Boolean(getSessionCookie(request))
  const isProtectedPath = isProtectedAppPath(url.pathname)

  if (isProtectedPath) {
    if (!hasActiveSession) {
      const callbackTarget = `${url.pathname}${url.search}`
      return buildLoginRedirect(request, callbackTarget)
    }
  }

  const reauth = url.searchParams.get('reauth') === '1'

  if (AUTH_ROUTES.has(url.pathname)) {
    if (reauth) {
      const response = NextResponse.next()
      clearAuthCookies(response)
      return response
    }

    if (hasActiveSession) {
      return NextResponse.redirect(new URL('/workspace', request.url))
    }
  }

  const workspaceInvitationRedirect = handleWorkspaceInvitationAPI(request, hasActiveSession)
  if (workspaceInvitationRedirect) return workspaceInvitationRedirect

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock

  const markdownRewrite = rewriteMarkdownRequest(request)
  if (markdownRewrite) return markdownRewrite

  const requestHeaders = new Headers(request.headers)
  if (isProtectedPath) {
    requestHeaders.set('x-auth-callback-url', `${url.pathname}${url.search}`)
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  response.headers.set('Vary', appendVaryHeader(appendVaryHeader(null, 'User-Agent'), 'Accept'))

  if (
    url.pathname.startsWith('/workspace') ||
    url.pathname.startsWith('/chat') ||
    url.pathname === '/'
  ) {
    response.headers.set('Content-Security-Policy', await generateRuntimeCSP())
  }

  if (url.pathname === '/') {
    appendHomepageDiscoveryLinks(response.headers)
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
