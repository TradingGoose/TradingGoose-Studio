export const ADMIN_ERROR_CODES = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  INVALID_REQUEST_DATA: 'invalid_request_data',
  FAILED_TO_LOAD_SYSTEM_SETTINGS: 'failed_to_load_system_settings',
  FAILED_TO_UPDATE_SYSTEM_SETTINGS: 'failed_to_update_system_settings',
  BILLING_NOT_CONFIGURED: 'billing_not_configured',
  BILLING_NOT_READY: 'billing_not_ready',
  TRIGGER_NOT_READY: 'trigger_not_ready',
  UNKNOWN: 'unknown',
} as const

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES]
