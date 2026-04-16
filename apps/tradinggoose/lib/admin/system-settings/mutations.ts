import { z } from 'zod'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'
import { ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS } from './types'

export const adminSystemSettingsMutationSchema = z.object({
  registrationMode: z.enum(REGISTRATION_MODE_VALUES),
  billingEnabled: z.boolean(),
  triggerDevEnabled: z.boolean(),
  allowPromotionCodes: z.boolean(),
  emailDomain: z.string().trim().min(1, 'Email domain is required'),
  fromEmailAddress: z.string().trim(),
})
  .partial()
  .refine(
    (input) => ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS.some((field) => Object.hasOwn(input, field)),
    { message: 'At least one system setting is required' }
  )

export type AdminSystemSettingsMutationInput = z.infer<typeof adminSystemSettingsMutationSchema>
