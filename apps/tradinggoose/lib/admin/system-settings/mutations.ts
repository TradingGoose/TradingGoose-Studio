import { z } from 'zod'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'

const trimmedSecretSchema = z.string().trim().min(1, 'Secret value is required')

export const adminSystemSettingsMutationSchema = z.object({
  registrationMode: z.enum(REGISTRATION_MODE_VALUES),
  billingEnabled: z.boolean(),
  allowPromotionCodes: z.boolean(),
  stripeSecretKey: trimmedSecretSchema.optional(),
  stripeWebhookSecret: trimmedSecretSchema.optional(),
})

export type AdminSystemSettingsMutationInput = z.infer<typeof adminSystemSettingsMutationSchema>
