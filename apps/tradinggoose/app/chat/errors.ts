import { CHAT_ERROR_CODES } from './constants'
import type { ChatMessages } from '@/i18n/message-types'

function normalizeChatErrorCode(code: string | null | undefined): string {
  return (code || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
}

export function getChatErrorMessage(copy: ChatMessages, codeOrMessage: string | null | undefined) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.CHAT_NOT_FOUND:
    case CHAT_ERROR_CODES.CHAT_UNAVAILABLE:
      return copy.errors.chatUnavailable
    case CHAT_ERROR_CODES.NO_CHAT_TRIGGER:
      return copy.errors.noChatTrigger
    case CHAT_ERROR_CODES.USAGE_LIMIT_EXCEEDED:
      return copy.errors.usageLimitExceeded
    case CHAT_ERROR_CODES.FAILED_TO_LOAD_CONFIG:
    case CHAT_ERROR_CODES.FAILED_TO_FETCH_CHAT_INFORMATION:
      return copy.errors.failedToLoadConfig
    case CHAT_ERROR_CODES.FAILED_TO_SEND_MESSAGE:
      return copy.errors.failedToSendMessage
    case CHAT_ERROR_CODES.FAILED_TO_GET_RESPONSE:
      return copy.errors.failedToGetResponse
    case CHAT_ERROR_CODES.RESPONSE_BODY_MISSING:
      return copy.errors.responseBodyMissing
    case CHAT_ERROR_CODES.REQUEST_TIMED_OUT:
      return copy.errors.timeout
    case CHAT_ERROR_CODES.RESPONSE_STOPPED_BY_USER:
      return copy.errors.responseStoppedByUser
    case CHAT_ERROR_CODES.API_KEY_REQUIRED:
      return copy.errors.chatUnavailable
    case CHAT_ERROR_CODES.PENDING_EXECUTION_BACKLOG_FULL:
      return copy.errors.usageLimitExceeded
    case CHAT_ERROR_CODES.GENERIC_ERROR:
      return copy.errors.generic
    default:
      return copy.errors.generic
  }
}

export function getChatPasswordAuthErrorMessage(
  copy: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_PASSWORD:
      return copy.auth.password.errors.authRequired
    case CHAT_ERROR_CODES.PASSWORD_REQUIRED:
      return copy.auth.password.validation.required
    case CHAT_ERROR_CODES.INVALID_PASSWORD:
      return copy.auth.password.errors.invalidPassword
    case CHAT_ERROR_CODES.AUTH_CONFIGURATION_ERROR:
      return copy.auth.password.errors.configurationError
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return copy.auth.password.errors.authenticationError
    default:
      return copy.auth.password.errors.authenticationError
  }
}

export function getChatEmailAuthErrorMessage(
  copy: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_EMAIL:
      return copy.auth.email.errors.authRequired
    case CHAT_ERROR_CODES.EMAIL_REQUIRED:
      return copy.auth.email.validation.required
    case CHAT_ERROR_CODES.INVALID_EMAIL:
      return copy.auth.email.validation.invalid
    case CHAT_ERROR_CODES.EMAIL_NOT_AUTHORIZED:
      return copy.auth.email.errors.notAuthorized
    case CHAT_ERROR_CODES.OTP_REQUIRED:
      return copy.auth.email.errors.otpRequired
    case CHAT_ERROR_CODES.OTP_NOT_FOUND:
      return copy.auth.email.errors.noCodeFound
    case CHAT_ERROR_CODES.OTP_INVALID:
      return copy.auth.email.errors.invalidCode
    case CHAT_ERROR_CODES.OTP_SEND_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_SEND_FAILED:
      return copy.auth.email.errors.sendFailed
    case CHAT_ERROR_CODES.OTP_RESEND_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_RESEND_FAILED:
      return copy.auth.email.errors.resendFailed
    case CHAT_ERROR_CODES.OTP_VERIFY_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_VERIFY_FAILED:
      return copy.auth.email.errors.verifyFailed
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return copy.auth.email.errors.authenticationError
    default:
      return copy.auth.email.errors.authenticationError
  }
}

export function getChatSsoAuthErrorMessage(copy: ChatMessages, codeOrMessage: string | null | undefined) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_SSO:
    case CHAT_ERROR_CODES.SSO_AUTHENTICATION_REQUIRED:
      return copy.auth.sso.errors.authRequired
    case CHAT_ERROR_CODES.EMAIL_REQUIRED:
      return copy.auth.sso.validation.required
    case CHAT_ERROR_CODES.INVALID_EMAIL:
      return copy.auth.sso.validation.invalid
    case CHAT_ERROR_CODES.SSO_EMAIL_NOT_AUTHORIZED:
      return copy.auth.sso.errors.notAuthorized
    case CHAT_ERROR_CODES.SSO_SESSION_MISSING_EMAIL:
      return copy.auth.sso.errors.sessionMissingEmail
    case CHAT_ERROR_CODES.SSO_AUTHENTICATION_ERROR:
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return copy.auth.sso.errors.authenticationError
    default:
      return copy.auth.sso.errors.authenticationError
  }
}

export function getChatInputErrorMessage(copy: ChatMessages, codeOrMessage: string | null | undefined) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.RESPONSE_STOPPED_BY_USER:
      return copy.errors.responseStoppedByUser
    default:
      return copy.errors.generic
  }
}
