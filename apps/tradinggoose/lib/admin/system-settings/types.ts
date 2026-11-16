import type { CopilotSettings } from '@/lib/copilot/settings'
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
  copilot: CopilotSettings
}

export type AdminSystemSettingsEditableFields = Pick<
  AdminSystemSettingsSnapshot,
  | 'registrationMode'
  | 'billingEnabled'
  | 'triggerDevEnabled'
  | 'allowPromotionCodes'
  | 'emailDomain'
  | 'fromEmailAddress'
  | 'copilot'
>

export const ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS = [
  'registrationMode',
  'billingEnabled',
  'triggerDevEnabled',
  'allowPromotionCodes',
  'emailDomain',
  'fromEmailAddress',
  'copilot',
] as const satisfies readonly (keyof AdminSystemSettingsEditableFields)[]
