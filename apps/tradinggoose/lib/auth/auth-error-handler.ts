'use client'

import { createLogger } from '@/lib/logs/console/logger'
import { isLocaleCode, normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('AuthErrorHandler')
let isHandlingAuthError = false
const LAST_RECOVERY_KEY = 'tradinggoose-auth-recovery-ts'
const AUTH_COOKIE_NAMES = [
  'better-auth.session_token',
  'better-auth.session_data',
  'better-auth.dont_remember',
  '__Secure-better-auth.session_token',
  '__Secure-better-auth.session_data',
  '__Secure-better-auth.dont_remember',
]

function deleteBrowserAuthCookies() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const baseDomain = window.location.hostname
  const domains = [undefined, baseDomain, `.${baseDomain}`].filter(Boolean)

  AUTH_COOKIE_NAMES.forEach((name) => {
    domains.forEach((domain) => {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${
        domain ? `; Domain=${domain}` : ''
      }`
    })
  })
}

function shouldRateLimitRecovery(reason?: string) {
  if (typeof window === 'undefined') return false

  // Avoid infinite reload loops on the login page by rate limiting recovery attempts
  const isOnLoginPage = isLoginPathname(window.location.pathname)
  if (!isOnLoginPage) return false

  const now = Date.now()
  const last = Number(window.sessionStorage.getItem(LAST_RECOVERY_KEY) || '0')
  if (now - last < 2000) {
    logger.warn('Skipping auth recovery to avoid reload loop on login page', { reason })
    return true
  }

  window.sessionStorage.setItem(LAST_RECOVERY_KEY, String(now))
  return false
}

function isLoginPathname(pathname: string) {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'login' || (segments[1] === 'login' && isLocaleCode(segments[0]))
}

async function safeServerSignOut() {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    logger.warn('Fallback sign-out failed', { error })
  }
}

/**
 * Clears the current auth session when we detect an unauthorized response.
 * This removes any stale tokens/cookies and forces a navigation to login so
 * the user can authenticate again.
 */
export async function handleAuthError(reason: string, callbackPathname: string) {
  if (typeof window === 'undefined') return
  if (isHandlingAuthError) return
  if (shouldRateLimitRecovery(reason)) return

  const canonicalCallbackPathname = normalizeCallbackUrl(callbackPathname)
  if (!canonicalCallbackPathname) {
    throw new Error('Expected a canonical auth recovery callback pathname')
  }

  isHandlingAuthError = true
  deleteBrowserAuthCookies()
  await safeServerSignOut()

  if (isLoginPathname(window.location.pathname)) {
    logger.warn('Cleared stale auth state on login page', { reason })
    isHandlingAuthError = false
    return
  }

  const callbackUrl = `${canonicalCallbackPathname}${window.location.search}${window.location.hash}`
  const loginPath = `/login?reauth=1&callbackUrl=${encodeURIComponent(callbackUrl)}`

  logger.warn('Handling authentication error', { reason, callbackUrl })
  window.location.replace(loginPath)
}

export function isAuthErrorStatus(status?: number | null): boolean {
  return status === 401
}
