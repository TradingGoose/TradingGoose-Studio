import { z } from 'zod'

const nullableTrimmedUrlSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .refine((value) => value === null || /^https?:\/\//.test(value), {
    message: 'Enterprise contact URL must start with http:// or https://',
  })

export const adminBillingSettingsMutationSchema = z.object({
  onboardingAllowanceUsd: z.number().finite().nonnegative(),
  overageThresholdDollars: z.number().finite().nonnegative(),
  workflowExecutionChargeUsd: z.number().finite().nonnegative(),
  functionExecutionChargeUsd: z.number().finite().nonnegative(),
  usageWarningThresholdPercent: z.number().int().min(1).max(100),
  freeTierUpgradeThresholdPercent: z.number().int().min(1).max(100),
  enterpriseContactUrl: nullableTrimmedUrlSchema,
})

export type AdminBillingSettingsMutationInput = z.infer<typeof adminBillingSettingsMutationSchema>
