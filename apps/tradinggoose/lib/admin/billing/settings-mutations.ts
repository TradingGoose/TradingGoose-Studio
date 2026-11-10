import { z } from 'zod'
import { adminMoneySchema } from './money-schema'

const nullableTrimmedUrlSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .refine((value) => value === null || /^https?:\/\//.test(value), {
    message: 'Enterprise contact URL must start with http:// or https://',
  })

export const adminBillingSettingsMutationSchema = z.object({
  onboardingAllowanceUsd: adminMoneySchema,
  overageThresholdDollars: adminMoneySchema,
  workflowExecutionChargeUsd: adminMoneySchema,
  functionExecutionChargeUsd: adminMoneySchema,
  usageWarningThresholdPercent: z.number().int().min(1).max(100),
  freeTierUpgradeThresholdPercent: z.number().int().min(1).max(100),
  enterpriseContactUrl: nullableTrimmedUrlSchema,
})

export type AdminBillingSettingsMutationInput = z.infer<typeof adminBillingSettingsMutationSchema>
