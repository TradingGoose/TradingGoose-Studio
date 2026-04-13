import {
  REGISTRATION_DISABLED_MESSAGE,
  REGISTRATION_WAITLIST_MESSAGE,
} from '@/lib/registration/shared'

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

const DEFAULT_AUTH_ERROR_CONTENT: AuthErrorContent = {
  title: 'Something went wrong',
  description: 'We could not complete that authentication request. Please try signing in again.',
  primaryAction: LOGIN_ACTION,
  secondaryAction: HOME_ACTION,
}

const REGISTRATION_WAITLIST_ERROR_CODE = normalizeAuthErrorCode(REGISTRATION_WAITLIST_MESSAGE)
const REGISTRATION_DISABLED_ERROR_CODE = normalizeAuthErrorCode(REGISTRATION_DISABLED_MESSAGE)

const AUTH_ERROR_CONTENT_BY_CODE: Record<string, AuthErrorContent> = {
  UNABLE_TO_CREATE_USER: {
    title: "We couldn't create your account",
    description:
      'Your sign-up request did not complete. Try again from the sign-up form, or log in if this email is already registered.',
    primaryAction: SIGNUP_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  FAILED_TO_CREATE_USER: {
    title: "We couldn't create your account",
    description:
      'Your sign-up request did not complete. Try again from the sign-up form, or log in if this email is already registered.',
    primaryAction: SIGNUP_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  USER_ALREADY_EXISTS: {
    title: 'Account already exists',
    description:
      'An account with this email is already registered. Sign in instead of creating a new account.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: SIGNUP_ACTION,
  },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
    title: 'Account already exists',
    description:
      'An account with this email is already registered. Sign in instead of creating a new account.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: SIGNUP_ACTION,
  },
  EMAIL_NOT_VERIFIED: {
    title: 'Verify your email to continue',
    description: 'Your account exists, but email verification still needs to be completed.',
    primaryAction: VERIFY_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  INVALID_CALLBACK_URL: {
    title: 'This sign-in link is invalid',
    description: 'The authentication callback was not valid. Start the sign-in flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  INVALID_REDIRECT_URL: {
    title: 'This sign-in link is invalid',
    description: 'The authentication callback was not valid. Start the sign-in flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  INVALID_ERROR_CALLBACK_URL: {
    title: 'This sign-in link is invalid',
    description: 'The authentication callback was not valid. Start the sign-in flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  INVALID_NEW_USER_CALLBACK_URL: {
    title: 'This sign-in link is invalid',
    description: 'The authentication callback was not valid. Start the sign-in flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  CALLBACK_URL_REQUIRED: {
    title: 'This sign-in link is invalid',
    description: 'The authentication callback was not valid. Start the sign-in flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  INVALID_TOKEN: {
    title: 'This authentication link is invalid',
    description: 'The link or token could not be verified. Start the authentication flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  TOKEN_EXPIRED: {
    title: 'This authentication link has expired',
    description: 'The link or token has expired. Start the authentication flow again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  FAILED_TO_CREATE_SESSION: {
    title: "We couldn't start your session",
    description:
      'Authentication succeeded, but the session could not be created. Try logging in again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  FAILED_TO_GET_SESSION: {
    title: "We couldn't restore your session",
    description: 'Your session could not be loaded. Try logging in again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  SESSION_EXPIRED: {
    title: 'Your session has expired',
    description: 'Sign in again to continue.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  FAILED_TO_GET_USER_INFO: {
    title: "We couldn't complete your sign-in",
    description: 'We were unable to read your identity from the provider. Try signing in again.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  USER_EMAIL_NOT_FOUND: {
    title: "We couldn't complete your sign-in",
    description:
      'The provider did not return an email address for this account. Try another sign-in method.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  PROVIDER_NOT_FOUND: {
    title: 'This sign-in provider is unavailable',
    description: 'The requested sign-in provider is not configured right now.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  SOCIAL_ACCOUNT_ALREADY_LINKED: {
    title: 'This provider is already linked',
    description:
      'That sign-in provider is already connected to another account. Use a different method to continue.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  LINKED_ACCOUNT_ALREADY_EXISTS: {
    title: 'This provider is already linked',
    description:
      'That sign-in provider is already connected to another account. Use a different method to continue.',
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
  [REGISTRATION_WAITLIST_ERROR_CODE!]: {
    title: 'Registration is limited',
    description: REGISTRATION_WAITLIST_MESSAGE,
    primaryAction: WAITLIST_ACTION,
    secondaryAction: LOGIN_ACTION,
  },
  [REGISTRATION_DISABLED_ERROR_CODE!]: {
    title: 'Registration is currently disabled',
    description: REGISTRATION_DISABLED_MESSAGE,
    primaryAction: LOGIN_ACTION,
    secondaryAction: HOME_ACTION,
  },
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
  error: string | null | undefined,
  errorDescription?: string | null
) {
  const code = normalizeAuthErrorCode(error)
  const normalizedDescription = errorDescription?.trim() || null
  const contentForCode = code ? AUTH_ERROR_CONTENT_BY_CODE[code] : null

  return {
    code,
    content: contentForCode
      ? {
          ...contentForCode,
          description: normalizedDescription || contentForCode.description,
        }
      : normalizedDescription
        ? {
            ...DEFAULT_AUTH_ERROR_CONTENT,
            description: normalizedDescription,
          }
        : DEFAULT_AUTH_ERROR_CONTENT,
  }
}
