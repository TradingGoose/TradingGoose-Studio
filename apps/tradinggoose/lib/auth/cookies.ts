import { getBaseUrl } from '@/lib/urls/utils'

const AUTH_COOKIE_BASE_NAMES = [
  'better-auth.session_token',
  'better-auth.session_data',
  'better-auth.dont_remember',
] as const

const SECURE_COOKIE_PREFIX = '__Secure-'
const AUTH_COOKIE_PREFIX = getBaseUrl().startsWith('https://') ? SECURE_COOKIE_PREFIX : ''
const AUTH_COOKIE_SECURE = AUTH_COOKIE_PREFIX === SECURE_COOKIE_PREFIX

export const AUTH_SESSION_COOKIE_NAME = `${AUTH_COOKIE_PREFIX}better-auth.session_token`

export const AUTH_COOKIE_NAMES = AUTH_COOKIE_BASE_NAMES.map((name) => `${AUTH_COOKIE_PREFIX}${name}`)

export function getAuthCookieDeletionOptions() {
  const options = {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax' as const,
  }

  return AUTH_COOKIE_SECURE ? { ...options, secure: true } : options
}
