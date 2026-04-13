import { z } from 'zod'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'

export const adminSystemSettingsMutationSchema = z.object({
  registrationMode: z.enum(REGISTRATION_MODE_VALUES),
  billingEnabled: z.boolean(),
  allowPromotionCodes: z.boolean(),
  emailDomain: z.string().trim().min(1, 'Email domain is required').optional(),
  fromEmailAddress: z.string().trim().optional(),
})

export type AdminSystemSettingsMutationInput = z.infer<typeof adminSystemSettingsMutationSchema>
