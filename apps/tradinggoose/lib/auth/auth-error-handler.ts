'use client'

import { createLogger } from '@/lib/logs/console/logger'

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
  const isOnLoginPage = window.location.pathname === '/login'
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
export async function handleAuthError(reason?: string) {
  if (typeof window === 'undefined') return
  if (isHandlingAuthError) return
  if (shouldRateLimitRecovery(reason)) return

  isHandlingAuthError = true
  deleteBrowserAuthCookies()
  await safeServerSignOut()

  if (window.location.pathname === '/login') {
    logger.warn('Cleared stale auth state on login page', { reason })
    isHandlingAuthError = false
    return
  }

  const callbackUrl = `${window.location.pathname}${window.location.search}`
  logger.warn('Handling authentication error', { reason, callbackUrl })
  window.location.replace(`/login?reauth=1&callbackUrl=${encodeURIComponent(callbackUrl)}`)
}

export function isAuthErrorStatus(status?: number | null): boolean {
  return status === 401
}
