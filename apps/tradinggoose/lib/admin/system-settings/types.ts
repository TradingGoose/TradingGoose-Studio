import type { RegistrationMode } from '@/lib/registration/shared'

export interface AdminSystemSettingsSnapshot {
  registrationMode: RegistrationMode
  billingEnabled: boolean
  billingReady: boolean
  triggerDevEnabled: boolean
  triggerReady: boolean
  allowPromotionCodes: boolean
  emailDomain: string
  fromEmailAddress: string
}
