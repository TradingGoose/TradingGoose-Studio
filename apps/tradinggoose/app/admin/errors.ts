import { ADMIN_ERROR_CODES } from './constants'
import type { Messages } from 'next-intl'

type AdminMessages = Messages['admin']

function normalizeAdminErrorCode(code: string | null | undefined): string {
  return (code || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

export function getAdminSystemSettingsErrorMessage(
  { errors: systemSettingsFailureCopy }: AdminMessages['systemSettings'],
  codeOrMessage: string | null | undefined
) {
  switch (normalizeAdminErrorCode(codeOrMessage)) {
    case ADMIN_ERROR_CODES.UNAUTHORIZED:
      return systemSettingsFailureCopy.unauthorized
    case ADMIN_ERROR_CODES.FORBIDDEN:
      return systemSettingsFailureCopy.forbidden
    case ADMIN_ERROR_CODES.INVALID_REQUEST_DATA:
      return systemSettingsFailureCopy.invalidRequest
    case ADMIN_ERROR_CODES.FAILED_TO_LOAD_SYSTEM_SETTINGS:
      return systemSettingsFailureCopy.load
    case ADMIN_ERROR_CODES.FAILED_TO_UPDATE_SYSTEM_SETTINGS:
      return systemSettingsFailureCopy.update
    case ADMIN_ERROR_CODES.BILLING_NOT_CONFIGURED:
      return systemSettingsFailureCopy.billingNotConfigured
    case ADMIN_ERROR_CODES.BILLING_NOT_READY:
      return systemSettingsFailureCopy.billingNotReady
    case ADMIN_ERROR_CODES.TRIGGER_NOT_READY:
      return systemSettingsFailureCopy.triggerNotReady
    default:
      return systemSettingsFailureCopy.unknown
  }
}
