import { ADMIN_ERROR_CODES } from './constants'
import type { AdminCopy } from './copy'

function normalizeAdminErrorCode(code: string | null | undefined): string {
  return (code || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
}

export function getAdminSystemSettingsErrorMessage(
  copy: AdminCopy['systemSettings'],
  codeOrMessage: string | null | undefined
) {
  switch (normalizeAdminErrorCode(codeOrMessage)) {
    case ADMIN_ERROR_CODES.UNAUTHORIZED:
      return copy.errors.unauthorized
    case ADMIN_ERROR_CODES.FORBIDDEN:
      return copy.errors.forbidden
    case ADMIN_ERROR_CODES.INVALID_REQUEST_DATA:
      return copy.errors.invalidRequest
    case ADMIN_ERROR_CODES.FAILED_TO_LOAD_SYSTEM_SETTINGS:
      return copy.errors.load
    case ADMIN_ERROR_CODES.FAILED_TO_UPDATE_SYSTEM_SETTINGS:
      return copy.errors.update
    case ADMIN_ERROR_CODES.BILLING_NOT_CONFIGURED:
      return copy.errors.billingNotConfigured
    case ADMIN_ERROR_CODES.BILLING_NOT_READY:
      return copy.errors.billingNotReady
    case ADMIN_ERROR_CODES.TRIGGER_NOT_READY:
      return copy.errors.triggerNotReady
    default:
      return copy.errors.unknown
  }
}
