import type { RegistrationMode } from '@/lib/registration/shared'

export interface AdminSystemSettingsSnapshot {
  registrationMode: RegistrationMode
  billingEnabled: boolean
  billingReady: boolean
  allowPromotionCodes: boolean
  stripeSecretKey: string
  stripeWebhookSecret: string
}
