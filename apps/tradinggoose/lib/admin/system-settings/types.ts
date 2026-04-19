import type { RegistrationMode } from '@/lib/registration/shared'

export interface AdminSystemSettingsSnapshot {
  registrationMode: RegistrationMode
  billingEnabled: boolean
  stripeConfigured: boolean
  billingReady: boolean
  triggerDevEnabled: boolean
  triggerReady: boolean
  allowPromotionCodes: boolean
  emailDomain: string
  fromEmailAddress: string
}

export type AdminSystemSettingsEditableFields = Pick<
  AdminSystemSettingsSnapshot,
  | 'registrationMode'
  | 'billingEnabled'
  | 'triggerDevEnabled'
  | 'allowPromotionCodes'
  | 'emailDomain'
  | 'fromEmailAddress'
>

export const ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS = [
  'registrationMode',
  'billingEnabled',
  'triggerDevEnabled',
  'allowPromotionCodes',
  'emailDomain',
  'fromEmailAddress',
] as const satisfies readonly (keyof AdminSystemSettingsEditableFields)[]
