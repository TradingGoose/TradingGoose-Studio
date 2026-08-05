import { z } from 'zod'

const nullableNumberSchema = z.number().finite().nonnegative().nullable()
const nullableIntegerSchema = z.number().int().nonnegative().nullable()
const nullablePositiveIntegerSchema = z.number().int().positive().nullable()
const nullableTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()

function hasPositiveNumber(value: number | null): value is number {
  return value !== null && value > 0
}

const adminBillingTierMutationShape = {
  displayName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: z.enum(['draft', 'active', 'archived']),
  ownerType: z.enum(['user', 'organization']),
  usageScope: z.enum(['individual', 'pooled']),
  seatMode: z.enum(['fixed', 'adjustable']),
  monthlyPriceUsd: nullableNumberSchema,
  yearlyPriceUsd: nullableNumberSchema,
  includedUsageLimitUsd: nullableNumberSchema,
  storageLimitGb: nullableIntegerSchema,
  concurrencyLimit: nullableIntegerSchema,
  seatCount: nullableIntegerSchema,
  seatMaximum: nullableIntegerSchema,
  stripeMonthlyPriceId: nullableTrimmedStringSchema,
  stripeYearlyPriceId: nullableTrimmedStringSchema,
  stripeProductId: nullableTrimmedStringSchema,
  accessCode: nullableTrimmedStringSchema,
  workflowExecutionTimeLimitSeconds: nullablePositiveIntegerSchema,
  syncRateLimitPerMinute: nullableIntegerSchema,
  asyncRateLimitPerMinute: nullableIntegerSchema,
  apiEndpointRateLimitPerMinute: nullableIntegerSchema,
  maxPendingAgeSeconds: nullableIntegerSchema,
  maxPendingCount: nullableIntegerSchema,
  canEditUsageLimit: z.boolean(),
  canConfigureSso: z.boolean(),
  logRetentionDays: nullableIntegerSchema,
  workflowExecutionMultiplier: nullableNumberSchema,
  workflowModelCostMultiplier: nullableNumberSchema,
  functionExecutionMultiplier: nullableNumberSchema,
  copilotCostMultiplier: nullableNumberSchema,
  pricingFeatures: z.array(z.string().trim().min(1)),
  isPublic: z.boolean(),
  isDefault: z.boolean(),
  displayOrder: z.number().int(),
}

export const adminBillingTierMutationSchema = z.object(adminBillingTierMutationShape)

export type AdminBillingTierMutationInput = z.infer<typeof adminBillingTierMutationSchema>

export function validateAdminBillingTierInput(input: AdminBillingTierMutationInput): string | null {
  if (input.isPublic && input.accessCode) {
    return 'Public tiers cannot configure an access code'
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

    if (hasPositiveNumber(input.monthlyPriceUsd) || hasPositiveNumber(input.yearlyPriceUsd)) {
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

  if (hasPositiveNumber(input.monthlyPriceUsd) && !input.stripeMonthlyPriceId) {
    return 'Tiers with a recurring monthly price must configure a Stripe monthly price ID'
  }

  if (hasPositiveNumber(input.yearlyPriceUsd) && !input.stripeYearlyPriceId) {
    return 'Tiers with a recurring yearly price must configure a Stripe yearly price ID'
  }

  if (input.seatMode === 'fixed' && input.seatMaximum !== null) {
    return 'Seat maximum is only used for adjustable organization tiers'
  }

  if (
    input.seatCount !== null &&
    input.seatMaximum !== null &&
    input.seatMaximum < input.seatCount
  ) {
    return 'Seat maximum cannot be less than the configured seat count'
  }

  return null
}
