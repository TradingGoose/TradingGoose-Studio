import {
  REGISTRATION_DISABLED_REASON,
  REGISTRATION_WAITLIST_REASON,
} from '@/lib/registration/shared'
import type { PublicCopy } from '@/i18n/public-copy'
import { normalizeCallbackUrl } from '@/i18n/utils'

export interface AuthErrorAction {
  href: string
  label: string
}

export interface AuthErrorContent {
  title: string
  description: string
  primaryAction: AuthErrorAction
  secondaryAction: AuthErrorAction
}

type AuthErrorGroupKey = keyof PublicCopy['auth']['error']['groups']

const LOGIN_HREF = '/login'
const REAUTH_LOGIN_HREF = '/login?reauth=1'
const SIGNUP_HREF = '/signup'
const HOME_HREF = '/'
const VERIFY_HREF = '/verify'
const WAITLIST_HREF = '/waitlist'
export const AUTH_ERROR_CALLBACK_COOKIE = 'tradinggoose_auth_error_callback'

const AUTH_ERROR_GROUP_BY_CODE: Partial<Record<string, AuthErrorGroupKey>> = {
  UNABLE_TO_CREATE_USER: 'accountCreation',
  FAILED_TO_CREATE_USER: 'accountCreation',
  USER_ALREADY_EXISTS: 'accountExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'accountExists',
  EMAIL_NOT_VERIFIED: 'emailVerification',
  INVALID_CALLBACK_URL: 'invalidCallback',
  INVALID_REDIRECT_URL: 'invalidCallback',
  INVALID_ERROR_CALLBACK_URL: 'invalidCallback',
  INVALID_NEW_USER_CALLBACK_URL: 'invalidCallback',
  CALLBACK_URL_REQUIRED: 'invalidCallback',
  INVALID_TOKEN: 'invalidToken',
  TOKEN_EXPIRED: 'expiredToken',
  UNABLE_TO_CREATE_SESSION: 'sessionCreation',
  FAILED_TO_CREATE_SESSION: 'sessionCreation',
  FAILED_TO_GET_SESSION: 'sessionRestore',
  SESSION_EXPIRED: 'sessionExpired',
  FAILED_TO_GET_USER_INFO: 'userInfo',
  USER_EMAIL_NOT_FOUND: 'userInfo',
  PROVIDER_NOT_FOUND: 'providerUnavailable',
  SOCIAL_ACCOUNT_ALREADY_LINKED: 'linkedAccount',
  LINKED_ACCOUNT_ALREADY_EXISTS: 'linkedAccount',
  REGISTRATION_WAITLIST: 'waitlistLimited',
  REGISTRATION_DISABLED: 'registrationDisabled',
  EMAIL_AND_PASSWORD_SIGN_IN_IS_NOT_ENABLED: 'providerUnavailable',
  EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED: 'accountCreation',
  EMAIL_PASSWORD_DISABLED: 'providerUnavailable',
}

export function normalizeAuthErrorCode(error: string | null | undefined) {
  if (!error) {
    return null
  }

  const normalized = error
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return normalized || null
}

export function normalizeStoredAuthErrorCallback(value: string | null | undefined) {
  if (!value) {
    return null
  }

  try {
    return normalizeCallbackUrl(decodeURIComponent(value))
  } catch {
    return null
  }
}

export function rememberAuthErrorCallback(value: string | null | undefined) {
  if (typeof document === 'undefined') {
    return
  }

  const callback = normalizeCallbackUrl(value)
  if (!callback) {
    return
  }

  document.cookie = `${AUTH_ERROR_CALLBACK_COOKIE}=${encodeURIComponent(callback)}; path=/; max-age=600; samesite=lax`
}

export function getClearAuthErrorCallbackCookie() {
  return `${AUTH_ERROR_CALLBACK_COOKIE}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`
}

function appendCallbackUrl(href: string, callbackUrl: string | null | undefined) {
  if (!callbackUrl) {
    return href
  }

  const separator = href.includes('?') ? '&' : '?'
  return `${href}${separator}callbackUrl=${encodeURIComponent(callbackUrl)}`
}

function getAuthErrorActionCopy(localeCopy: PublicCopy, callbackUrl?: string | null) {
  return {
    login: {
      href: appendCallbackUrl(LOGIN_HREF, callbackUrl),
      label: localeCopy.auth.common.backToLogin,
    },
    reauthLogin: {
      href: appendCallbackUrl(REAUTH_LOGIN_HREF, callbackUrl),
      label: localeCopy.auth.common.backToLogin,
    },
    signup: {
      href: appendCallbackUrl(SIGNUP_HREF, callbackUrl),
      label: localeCopy.auth.common.backToSignup,
    },
    home: {
      href: HOME_HREF,
      label: localeCopy.auth.common.returnHome,
    },
    verify: {
      href: VERIFY_HREF,
      label: localeCopy.auth.common.verifyEmail,
    },
    waitlist: {
      href: WAITLIST_HREF,
      label: localeCopy.auth.common.requestAccess,
    },
  }
}

function resolveAuthErrorGroupKey(errorCode: string | null): AuthErrorGroupKey | null {
  if (!errorCode) {
    return null
  }

  return AUTH_ERROR_GROUP_BY_CODE[errorCode] ?? null
}

function isSessionRecoveryGroup(groupKey: AuthErrorGroupKey) {
  return (
    groupKey === 'sessionCreation' || groupKey === 'sessionRestore' || groupKey === 'sessionExpired'
  )
}

export function getAuthErrorContent(
  copy: PublicCopy,
  error: string | null | undefined,
  errorDescription?: string | null,
  callbackUrl?: string | null
) {
  const code = normalizeAuthErrorCode(error)
  const descriptionCode = normalizeAuthErrorCode(errorDescription)
  const groupKey = resolveAuthErrorGroupKey(code) ?? resolveAuthErrorGroupKey(descriptionCode)
  const actionCopy = getAuthErrorActionCopy(copy, callbackUrl)
  const normalizedDescription = errorDescription?.trim() || null

  if (groupKey) {
    const group = copy.auth.error.groups[groupKey]
    const primaryAction =
      groupKey === 'accountCreation'
        ? actionCopy.signup
        : groupKey === 'emailVerification'
          ? actionCopy.verify
          : groupKey === 'waitlistLimited'
            ? actionCopy.waitlist
            : isSessionRecoveryGroup(groupKey)
              ? actionCopy.reauthLogin
              : actionCopy.login
    const secondaryAction =
      groupKey === 'accountCreation' ||
      groupKey === 'emailVerification' ||
      groupKey === 'waitlistLimited'
        ? actionCopy.login
        : groupKey === 'accountExists'
          ? actionCopy.signup
          : actionCopy.home
    const content: AuthErrorContent = {
      title: group.title,
      description:
        normalizedDescription && descriptionCode && !resolveAuthErrorGroupKey(descriptionCode)
          ? normalizedDescription
          : group.description,
      primaryAction,
      secondaryAction,
    }

    return {
      code,
      content,
    }
  }

  return {
    code,
    content: {
      title: copy.auth.error.default.title,
      description: normalizedDescription ?? copy.auth.error.default.description,
      primaryAction: actionCopy.login,
      secondaryAction: actionCopy.home,
    },
  }
}

export function resolveAuthErrorGroup(
  error: string | null | undefined,
  errorDescription?: string | null
) {
  const code = normalizeAuthErrorCode(error)
  const descriptionCode = normalizeAuthErrorCode(errorDescription)

  return resolveAuthErrorGroupKey(code) ?? resolveAuthErrorGroupKey(descriptionCode)
}

export function isRegistrationDisabledReason(value: string | null | undefined) {
  const normalized = normalizeAuthErrorCode(value)
  return normalized === normalizeAuthErrorCode(REGISTRATION_DISABLED_REASON)
}

export function isRegistrationWaitlistReason(value: string | null | undefined) {
  const normalized = normalizeAuthErrorCode(value)
  return normalized === normalizeAuthErrorCode(REGISTRATION_WAITLIST_REASON)
}
