import { compareMoney, type DecimalAmount, monetary } from '@tradinggoose/billing/money'
import { z } from 'zod'
import { adminMoneySchema } from './money-schema'

const nullableMoneySchema = adminMoneySchema.nullable()
const nullableIntegerSchema = z.number().int().safe().nonnegative().nullable()
const nullableExecutionTimeLimitSchema = z.number().int().min(5).max(2_147_483).nullable()
const nullableTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()

function hasPositiveAmount(value: DecimalAmount | null): boolean {
  return value !== null && compareMoney(value, '0') > 0
}

export const adminBillingTierMutationSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  accessCode: nullableTrimmedStringSchema,
  status: z.enum(['draft', 'active', 'archived']),
  ownerType: z.enum(['user', 'organization']),
  usageScope: z.enum(['individual', 'pooled']),
  seatMode: z.enum(['fixed', 'adjustable']),
  monthlyPriceUsd: nullableMoneySchema,
  yearlyPriceUsd: nullableMoneySchema,
  includedUsageLimitUsd: nullableMoneySchema,
  storageLimitGb: nullableIntegerSchema,
  concurrencyLimit: nullableIntegerSchema,
  workflowExecutionTimeLimitSeconds: nullableExecutionTimeLimitSchema,
  seatCount: nullableIntegerSchema,
  seatMaximum: nullableIntegerSchema,
  stripeMonthlyPriceId: nullableTrimmedStringSchema,
  stripeYearlyPriceId: nullableTrimmedStringSchema,
  stripeProductId: nullableTrimmedStringSchema,
  syncRateLimitPerMinute: nullableIntegerSchema,
  asyncRateLimitPerMinute: nullableIntegerSchema,
  apiEndpointRateLimitPerMinute: nullableIntegerSchema,
  maxPendingAgeSeconds: nullableIntegerSchema.optional().default(null),
  maxPendingCount: nullableIntegerSchema.optional().default(null),
  canEditUsageLimit: z.boolean(),
  canConfigureSso: z.boolean(),
  logRetentionDays: nullableIntegerSchema,
  workflowExecutionMultiplier: nullableMoneySchema,
  workflowModelCostMultiplier: nullableMoneySchema,
  functionExecutionMultiplier: nullableMoneySchema,
  copilotCostMultiplier: nullableMoneySchema,
  pricingFeatures: z.array(z.string().trim().min(1)),
  isPublic: z.boolean(),
  isDefault: z.boolean(),
  displayOrder: z.number().int().safe(),
})

export type AdminBillingTierMutationInput = z.infer<typeof adminBillingTierMutationSchema>

export function toBillingTierMutationValues(
  input: AdminBillingTierMutationInput,
  updatedByUserId: string
) {
  return {
    ...input,
    monthlyPriceUsd: input.monthlyPriceUsd === null ? null : monetary(input.monthlyPriceUsd),
    yearlyPriceUsd: input.yearlyPriceUsd === null ? null : monetary(input.yearlyPriceUsd),
    includedUsageLimitUsd:
      input.includedUsageLimitUsd === null ? null : monetary(input.includedUsageLimitUsd),
    workflowExecutionMultiplier: monetary(input.workflowExecutionMultiplier ?? '1'),
    workflowModelCostMultiplier: monetary(input.workflowModelCostMultiplier ?? '1'),
    functionExecutionMultiplier: monetary(input.functionExecutionMultiplier ?? '1'),
    copilotCostMultiplier: monetary(input.copilotCostMultiplier ?? '1'),
    updatedByUserId,
    updatedAt: new Date(),
  }
}

type AdminBillingTierValidationOptions = {
  requireStripeMonthlyPriceId?: boolean
}

export function validateAdminBillingTierInput(
  input: AdminBillingTierMutationInput,
  options: AdminBillingTierValidationOptions = {}
): string | null {
  if (input.isPublic && input.accessCode) {
    return 'Public tiers cannot configure a private access code'
  }

  if (input.accessCode && !input.stripeMonthlyPriceId) {
    return 'Private tiers with an access code must configure a Stripe monthly price ID'
  }

  if (input.stripeYearlyPriceId && !input.stripeMonthlyPriceId) {
    return 'Stripe yearly prices require a Stripe monthly price ID'
  }

  if (input.stripeMonthlyPriceId && input.stripeMonthlyPriceId === input.stripeYearlyPriceId) {
    return 'Stripe monthly and yearly price IDs must be different'
  }

  if (input.isDefault) {
    if (!input.isPublic) {
      return 'The default tier must be visible in the public catalog'
    }

    if (
      input.ownerType !== 'user' ||
      input.usageScope !== 'individual' ||
      input.seatMode !== 'fixed'
    ) {
      return 'The default tier must be a public user tier with individual usage and fixed seats'
    }

    if (hasPositiveAmount(input.monthlyPriceUsd) || hasPositiveAmount(input.yearlyPriceUsd)) {
      return 'The default tier cannot configure a recurring price'
    }
  }

  if (input.ownerType === 'user') {
    if (input.usageScope !== 'individual') {
      return 'User tiers must use individual usage'
    }

    if (input.seatMode !== 'fixed') {
      return 'User tiers cannot use adjustable seats'
    }

    if (input.seatCount !== null || input.seatMaximum !== null) {
      return 'User tiers cannot configure organization seat counts'
    }

    if (input.canConfigureSso) {
      return 'User tiers cannot configure SSO'
    }
  }

  if (input.ownerType === 'organization') {
    if (input.seatCount === null) {
      return 'Organization tiers must configure a seat count'
    }
  }

  if (input.includedUsageLimitUsd === null) {
    return 'Billing tiers must configure an included usage limit'
  }

  if (input.status === 'active') {
    if (
      input.syncRateLimitPerMinute === null ||
      input.asyncRateLimitPerMinute === null ||
      input.apiEndpointRateLimitPerMinute === null
    ) {
      return 'Active tiers must configure explicit per-minute rate limits'
    }

    if (input.storageLimitGb === null) {
      return 'Active tiers must configure a storage limit'
    }

    if (input.concurrencyLimit === null) {
      return 'Active tiers must configure a concurrency limit'
    }
  }

  if (options.requireStripeMonthlyPriceId && !input.stripeMonthlyPriceId) {
    return 'New tiers must configure a Stripe monthly price ID'
  }

  if (input.isPublic && hasPositiveAmount(input.monthlyPriceUsd) && !input.stripeMonthlyPriceId) {
    return 'Public tiers with a recurring monthly price must configure a Stripe monthly price ID'
  }

  if (input.isPublic && hasPositiveAmount(input.yearlyPriceUsd) && !input.stripeYearlyPriceId) {
    return 'Public tiers with a recurring yearly price must configure a Stripe yearly price ID'
  }

  if (input.seatMode === 'fixed' && input.seatMaximum !== null) {
    return 'Seat maximum is only used for adjustable organization tiers'
  }

  if (
    input.seatMode === 'fixed' &&
    input.ownerType !== 'organization' &&
    input.seatCount !== null
  ) {
    return 'Seat count is only used for organization tiers'
  }

  if (input.seatMode === 'adjustable' && input.ownerType !== 'organization') {
    return 'Adjustable seats are only supported for organization tiers'
  }

  if (input.seatMode === 'adjustable' && input.seatCount === null) {
    return 'Adjustable organization tiers must configure a base seat count'
  }

  if (
    input.seatCount !== null &&
    input.seatMaximum !== null &&
    input.seatMaximum < input.seatCount
  ) {
    return 'Seat maximum cannot be less than the configured seat count'
  }

  if (
    input.ownerType === 'organization' &&
    input.seatMode === 'fixed' &&
    input.seatCount === null
  ) {
    return 'Fixed organization tiers must configure a seat count'
  }

  if (
    input.ownerType === 'organization' &&
    input.seatMode === 'adjustable' &&
    input.seatCount === null
  ) {
    return 'Adjustable organization tiers must configure a seat count'
  }

  if (input.ownerType !== 'organization') {
    if (input.seatCount !== null || input.seatMaximum !== null) {
      return 'Seat count and seat maximum are only used for organization tiers'
    }
  }

  return null
}
