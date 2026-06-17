const AUTH_COOKIE_BASE_NAMES = [
  'better-auth.session_token',
  'better-auth.session_data',
  'better-auth.dont_remember',
] as const

const SECURE_COOKIE_PREFIX = '__Secure-'

export const AUTH_COOKIE_NAMES = AUTH_COOKIE_BASE_NAMES.flatMap((name) => [
  name,
  `${SECURE_COOKIE_PREFIX}${name}`,
])

function isSecureAuthCookieName(name: string) {
  return name.startsWith(SECURE_COOKIE_PREFIX)
}

export function getAuthCookieDeletionOptions(name: string) {
  const options = {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax' as const,
  }

  return isSecureAuthCookieName(name) ? { ...options, secure: true } : options
}
