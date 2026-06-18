import {
  REGISTRATION_DISABLED_REASON,
  REGISTRATION_WAITLIST_REASON,
} from '@/lib/registration/shared'
import type { PublicCopy } from '@/i18n/public-copy'

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
const SIGNUP_HREF = '/signup'
const HOME_HREF = '/'
const VERIFY_HREF = '/verify'
const WAITLIST_HREF = '/waitlist'

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

function getAuthErrorActionCopy(localeCopy: PublicCopy) {
  return {
    login: {
      href: LOGIN_HREF,
      label: localeCopy.auth.common.backToLogin,
    },
    signup: {
      href: SIGNUP_HREF,
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

export function getAuthErrorContent(
  copy: PublicCopy,
  error: string | null | undefined,
  errorDescription?: string | null
) {
  const code = normalizeAuthErrorCode(error)
  const descriptionCode = normalizeAuthErrorCode(errorDescription)
  const groupKey = resolveAuthErrorGroupKey(code) ?? resolveAuthErrorGroupKey(descriptionCode)
  const actionCopy = getAuthErrorActionCopy(copy)
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
