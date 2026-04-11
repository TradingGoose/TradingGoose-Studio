import { z } from 'zod'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'

const trimmedSecretSchema = z.string().transform((value) => value.trim())

export const adminSystemSettingsMutationSchema = z.object({
  registrationMode: z.enum(REGISTRATION_MODE_VALUES),
  billingEnabled: z.boolean(),
  allowPromotionCodes: z.boolean(),
  stripeSecretKey: trimmedSecretSchema,
  stripeWebhookSecret: trimmedSecretSchema,
})

export type AdminSystemSettingsMutationInput = z.infer<typeof adminSystemSettingsMutationSchema>
