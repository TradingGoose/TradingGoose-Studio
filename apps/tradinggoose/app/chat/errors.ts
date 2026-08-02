import { CHAT_ERROR_CODES } from './constants'
import type { Messages } from 'next-intl'

type ChatMessages = Messages['chat']

function normalizeChatErrorCode(code: string | null | undefined): string {
  return (code || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

export function getChatErrorMessage(
  { errors: chatFailureCopy }: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.CHAT_NOT_FOUND:
    case CHAT_ERROR_CODES.CHAT_UNAVAILABLE:
      return chatFailureCopy.chatUnavailable
    case CHAT_ERROR_CODES.NO_CHAT_TRIGGER:
      return chatFailureCopy.noChatTrigger
    case CHAT_ERROR_CODES.USAGE_LIMIT_EXCEEDED:
      return chatFailureCopy.usageLimitExceeded
    case CHAT_ERROR_CODES.FAILED_TO_LOAD_CONFIG:
    case CHAT_ERROR_CODES.FAILED_TO_FETCH_CHAT_INFORMATION:
      return chatFailureCopy.failedToLoadConfig
    case CHAT_ERROR_CODES.FAILED_TO_SEND_MESSAGE:
      return chatFailureCopy.failedToSendMessage
    case CHAT_ERROR_CODES.FAILED_TO_GET_RESPONSE:
      return chatFailureCopy.failedToGetResponse
    case CHAT_ERROR_CODES.RESPONSE_BODY_MISSING:
      return chatFailureCopy.responseBodyMissing
    case CHAT_ERROR_CODES.REQUEST_TIMED_OUT:
      return chatFailureCopy.timeout
    case CHAT_ERROR_CODES.RESPONSE_STOPPED_BY_USER:
      return chatFailureCopy.responseStoppedByUser
    case CHAT_ERROR_CODES.API_KEY_REQUIRED:
      return chatFailureCopy.chatUnavailable
    case CHAT_ERROR_CODES.PENDING_EXECUTION_BACKLOG_FULL:
      return chatFailureCopy.usageLimitExceeded
    case CHAT_ERROR_CODES.GENERIC_ERROR:
      return chatFailureCopy.generic
    default:
      return chatFailureCopy.generic
  }
}

export function getChatPasswordAuthErrorMessage(
  {
    auth: {
      password: { errors: passwordFailureCopy, validation: passwordValidationCopy },
    },
  }: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_PASSWORD:
      return passwordFailureCopy.authRequired
    case CHAT_ERROR_CODES.PASSWORD_REQUIRED:
      return passwordValidationCopy.required
    case CHAT_ERROR_CODES.INVALID_PASSWORD:
      return passwordFailureCopy.invalidPassword
    case CHAT_ERROR_CODES.AUTH_CONFIGURATION_ERROR:
      return passwordFailureCopy.configurationError
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return passwordFailureCopy.authenticationError
    default:
      return passwordFailureCopy.authenticationError
  }
}

export function getChatEmailAuthErrorMessage(
  {
    auth: {
      email: { errors: emailFailureCopy, validation: emailValidationCopy },
    },
  }: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_EMAIL:
      return emailFailureCopy.authRequired
    case CHAT_ERROR_CODES.EMAIL_REQUIRED:
      return emailValidationCopy.required
    case CHAT_ERROR_CODES.INVALID_EMAIL:
      return emailValidationCopy.invalid
    case CHAT_ERROR_CODES.EMAIL_NOT_AUTHORIZED:
      return emailFailureCopy.notAuthorized
    case CHAT_ERROR_CODES.OTP_REQUIRED:
      return emailFailureCopy.otpRequired
    case CHAT_ERROR_CODES.OTP_NOT_FOUND:
      return emailFailureCopy.noCodeFound
    case CHAT_ERROR_CODES.OTP_INVALID:
      return emailFailureCopy.invalidCode
    case CHAT_ERROR_CODES.OTP_SEND_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_SEND_FAILED:
      return emailFailureCopy.sendFailed
    case CHAT_ERROR_CODES.OTP_RESEND_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_RESEND_FAILED:
      return emailFailureCopy.resendFailed
    case CHAT_ERROR_CODES.OTP_VERIFY_FAILED:
    case CHAT_ERROR_CODES.VERIFICATION_CODE_VERIFY_FAILED:
      return emailFailureCopy.verifyFailed
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return emailFailureCopy.authenticationError
    default:
      return emailFailureCopy.authenticationError
  }
}

export function getChatSsoAuthErrorMessage(
  {
    auth: {
      sso: { errors: ssoFailureCopy, validation: ssoValidationCopy },
    },
  }: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.AUTH_REQUIRED_SSO:
    case CHAT_ERROR_CODES.SSO_AUTHENTICATION_REQUIRED:
      return ssoFailureCopy.authRequired
    case CHAT_ERROR_CODES.EMAIL_REQUIRED:
      return ssoValidationCopy.required
    case CHAT_ERROR_CODES.INVALID_EMAIL:
      return ssoValidationCopy.invalid
    case CHAT_ERROR_CODES.SSO_EMAIL_NOT_AUTHORIZED:
      return ssoFailureCopy.notAuthorized
    case CHAT_ERROR_CODES.SSO_SESSION_MISSING_EMAIL:
      return ssoFailureCopy.sessionMissingEmail
    case CHAT_ERROR_CODES.SSO_AUTHENTICATION_ERROR:
    case CHAT_ERROR_CODES.AUTHENTICATION_ERROR:
      return ssoFailureCopy.authenticationError
    default:
      return ssoFailureCopy.authenticationError
  }
}

export function getChatInputErrorMessage(
  { errors: chatFailureCopy }: ChatMessages,
  codeOrMessage: string | null | undefined
) {
  switch (normalizeChatErrorCode(codeOrMessage)) {
    case CHAT_ERROR_CODES.RESPONSE_STOPPED_BY_USER:
      return chatFailureCopy.responseStoppedByUser
    default:
      return chatFailureCopy.generic
  }
}
