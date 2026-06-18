'use client'

import { createLogger } from '@/lib/logs/console/logger'
import { isLocaleCode, normalizeCallbackUrl } from '@/i18n/utils'

const logger = createLogger('AuthErrorHandler')
let isHandlingAuthError = false
const LAST_RECOVERY_KEY = 'tradinggoose-auth-recovery-ts'

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

/**
 * Routes stale auth state to the login reauth flow.
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

  if (isLoginPathname(window.location.pathname)) {
    const loginUrl = new URL(window.location.href)
    loginUrl.searchParams.set('reauth', '1')
    logger.warn('Routing login page through reauth cleanup', { reason })
    window.location.replace(`${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`)
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
