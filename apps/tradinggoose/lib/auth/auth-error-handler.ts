'use client'

import { signOut } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { clearUserData } from '@/stores'

const logger = createLogger('AuthErrorHandler')
let isHandlingAuthError = false
const LAST_RECOVERY_KEY = 'sim-auth-recovery-ts'
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
  logger.warn('Handling authentication error, clearing client auth state', { reason })

  try {
    deleteBrowserAuthCookies()
    await Promise.allSettled([signOut(), safeServerSignOut(), clearUserData()])
  } catch (error) {
    logger.error('Failed to clear client auth state', { error })
  } finally {
    const target = '/login?reauth=1'
    if (window.location.pathname !== '/login') {
      window.location.replace(target)
    } else {
      // Already on login, just refresh to remove stale cookies
      window.location.reload()
    }
    isHandlingAuthError = false
  }
}

export function isAuthErrorStatus(status?: number | null): boolean {
  return status === 401
}
