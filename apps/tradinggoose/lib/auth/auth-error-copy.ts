import {
  REGISTRATION_DISABLED_MESSAGE,
  REGISTRATION_WAITLIST_MESSAGE,
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

const LOGIN_ACTION: AuthErrorAction = {
  href: '/login?reauth=1',
  label: 'Back to login',
}

const SIGNUP_ACTION: AuthErrorAction = {
  href: '/signup',
  label: 'Back to sign up',
}

const HOME_ACTION: AuthErrorAction = {
  href: '/',
  label: 'Return home',
}

const VERIFY_ACTION: AuthErrorAction = {
  href: '/verify',
  label: 'Verify email',
}

const WAITLIST_ACTION: AuthErrorAction = {
  href: '/waitlist',
  label: 'Join waitlist',
}

const DEFAULT_AUTH_ERROR_ACTIONS = {
  primaryAction: LOGIN_ACTION,
  secondaryAction: HOME_ACTION,
}

const AUTH_ERROR_ACTIONS_BY_GROUP: Record<
  AuthErrorGroupKey,
  {
    primaryAction: AuthErrorAction
    secondaryAction: AuthErrorAction
  }
> = {
  accountCreation: {
    primaryAction: SIGNUP_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  accountExists: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: SIGNUP_ACTION,
  },
  emailVerification: {
    primaryAction: VERIFY_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  invalidCallback: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  invalidToken: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  expiredToken: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  sessionCreation: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  sessionRestore: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  sessionExpired: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  userInfo: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  providerUnavailable: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  linkedAccount: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  waitlistLimited: {
    primaryAction: WAITLIST_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  registrationDisabled: {
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
}

export function getAuthErrorActionLabel(
  copy: PublicCopy,
  href: string,
  fallbackLabel: string
): string {
  if (href.startsWith('/login')) return copy.auth.common.backToLogin
  if (href === '/signup') return copy.auth.common.backToSignup
  if (href === '/') return copy.auth.common.returnHome
  if (href === '/verify') return copy.auth.common.verifyEmail
  if (href === '/waitlist') return copy.registration.waitlist.auth

  return fallbackLabel
}

const REGISTRATION_WAITLIST_ERROR_CODE = normalizeAuthErrorCode(REGISTRATION_WAITLIST_MESSAGE)
const REGISTRATION_DISABLED_ERROR_CODE = normalizeAuthErrorCode(REGISTRATION_DISABLED_MESSAGE)

const AUTH_ERROR_GROUP_BY_CODE: Record<string, AuthErrorGroupKey> = {
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
}

if (REGISTRATION_WAITLIST_ERROR_CODE) {
  AUTH_ERROR_GROUP_BY_CODE[REGISTRATION_WAITLIST_ERROR_CODE] = 'waitlistLimited'
}

if (REGISTRATION_DISABLED_ERROR_CODE) {
  AUTH_ERROR_GROUP_BY_CODE[REGISTRATION_DISABLED_ERROR_CODE] = 'registrationDisabled'
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

export function getAuthErrorContent(
  copy: PublicCopy,
  error: string | null | undefined,
  errorDescription?: string | null
) {
  const code = normalizeAuthErrorCode(error)
  const normalizedDescription = errorDescription?.trim() || null
  const errorCopy = copy.auth.error
  const groupKey = code ? AUTH_ERROR_GROUP_BY_CODE[code] : null
  const content = groupKey ? errorCopy.groups[groupKey] : errorCopy.default
  const actions = groupKey ? AUTH_ERROR_ACTIONS_BY_GROUP[groupKey] : DEFAULT_AUTH_ERROR_ACTIONS

  return {
    code,
    content: {
      title: content.title,
      description: normalizedDescription || content.description,
      primaryAction: actions.primaryAction,
      secondaryAction: actions.secondaryAction,
    },
  }
}
