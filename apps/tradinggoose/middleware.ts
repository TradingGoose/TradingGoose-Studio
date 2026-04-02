import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Middleware')

const AUTH_ROUTES = new Set(['/login', '/signup'])

/**
 * When running in hosted mode (tradinggoose.ai / staging), only landing pages
 * are served. Every other route gets a 404 so we can show "coming soon" only.
 */
const HOSTED_ALLOWED_PATHS = new Set(['/', '/licenses', '/privacy', '/terms'])

function isHostedEnvironment(): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  return appUrl === 'https://www.tradinggoose.ai' || appUrl === 'https://staging.tradinggoose.ai'
}

function isAllowedInHostedMode(pathname: string): boolean {
  if (HOSTED_ALLOWED_PATHS.has(pathname)) return true
  // Allow static assets, Next.js internals, and public files
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/favicon')) return true
  if (pathname.startsWith('/social/')) return true
  if (pathname.startsWith('/logo/')) return true
  if (pathname.startsWith('/static/')) return true
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml' || pathname === '/manifest.webmanifest') return true
  if (pathname === '/changelog.xml' || pathname === '/llms.txt') return true
  return false
}
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

export async function middleware(request: NextRequest) {
  const url = request.nextUrl

  // In hosted mode, only serve landing pages — everything else is 404
  if (isHostedEnvironment() && !isAllowedInHostedMode(url.pathname)) {
    return NextResponse.rewrite(new URL('/not-found', request.url), { status: 404 })
  }

  const hasActiveSession = Boolean(getSessionCookie(request))

  if (
    url.pathname.startsWith('/workspace') ||
    url.pathname === '/w' ||
    url.pathname.startsWith('/w/')
  ) {
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

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')

  if (
    url.pathname.startsWith('/workspace') ||
    url.pathname.startsWith('/chat') ||
    url.pathname === '/'
  ) {
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
  }

  return response
}

export const config = {
  matcher: [
    '/', // Root path for self-hosted redirect logic
    '/terms', // Whitelabel terms redirect
    '/privacy', // Whitelabel privacy redirect
    '/w', // Legacy /w redirect
    '/w/:path*', // Legacy /w/* redirects
    '/workspace/:path*', // New workspace routes
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!_next/static|_next/image|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
