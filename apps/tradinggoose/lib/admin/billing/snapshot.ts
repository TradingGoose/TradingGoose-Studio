import { db } from '@tradinggoose/db'
import { subscription } from '@tradinggoose/db/schema'
import { count, inArray } from 'drizzle-orm'
import {
  DEFAULT_BILLING_SETTINGS,
  getResolvedBillingSettings,
} from '@/lib/billing/settings'
import {
  type BillingTierRecord,
  getAllBillingTiers,
  parseBillingAmount,
} from '@/lib/billing/tiers'
import type { AdminBillingSnapshot, AdminBillingTierSnapshot } from './types'

function toTierSnapshot(tier: BillingTierRecord): AdminBillingTierSnapshot {
  return {
    id: tier.id,
    displayName: tier.displayName,
    description: tier.description,
    status: tier.status,
    ownerType: tier.ownerType,
    usageScope: tier.usageScope,
    seatMode: tier.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
    monthlyPriceUsd:
      tier.monthlyPriceUsd === null
        ? null
        : parseBillingAmount(tier.monthlyPriceUsd),
    yearlyPriceUsd:
      tier.yearlyPriceUsd === null
        ? null
        : parseBillingAmount(tier.yearlyPriceUsd),
    includedUsageLimitUsd:
      tier.includedUsageLimitUsd === null
        ? null
        : parseBillingAmount(tier.includedUsageLimitUsd),
    storageLimitGb: tier.storageLimitGb,
    concurrencyLimit: tier.concurrencyLimit,
    seatCount: tier.seatCount,
    seatMaximum: tier.seatMaximum,
    stripeMonthlyPriceId: tier.stripeMonthlyPriceId,
    stripeYearlyPriceId: tier.stripeYearlyPriceId,
    stripeProductId: tier.stripeProductId,
    syncRateLimitPerMinute: tier.syncRateLimitPerMinute ?? null,
    asyncRateLimitPerMinute: tier.asyncRateLimitPerMinute ?? null,
    apiEndpointRateLimitPerMinute: tier.apiEndpointRateLimitPerMinute ?? null,
    maxPendingAgeSeconds: tier.maxPendingAgeSeconds ?? null,
    maxPendingCount: tier.maxPendingCount ?? null,
    canEditUsageLimit: tier.canEditUsageLimit,
    canConfigureSso: tier.canConfigureSso,
    logRetentionDays: tier.logRetentionDays,
    workflowModelCostMultiplier:
      tier.workflowModelCostMultiplier === null
        ? null
        : parseBillingAmount(tier.workflowModelCostMultiplier),
    functionExecutionDurationMultiplier:
      tier.functionExecutionDurationMultiplier === null
        ? null
        : parseBillingAmount(tier.functionExecutionDurationMultiplier),
    copilotCostMultiplier:
      tier.copilotCostMultiplier === null
        ? null
        : parseBillingAmount(tier.copilotCostMultiplier),
    pricingFeatures: tier.pricingFeatures,
    isPublic: tier.isPublic,
    isDefault: tier.isDefault,
    displayOrder: tier.displayOrder,
    subscriptionCount: 0,
  }
}

async function buildCurrentTiers(): Promise<AdminBillingTierSnapshot[]> {
  const tiers = await getAllBillingTiers()
  const snapshots = tiers.map(toTierSnapshot)
  const tierIds = snapshots.map((tier) => tier.id)

  if (tierIds.length === 0) {
    return snapshots
  }

  const subscriptionCounts = await db
    .select({
      billingTierId: subscription.billingTierId,
      count: count(),
    })
    .from(subscription)
    .where(inArray(subscription.billingTierId, tierIds))
    .groupBy(subscription.billingTierId)

  const countsByTierId = new Map(
    subscriptionCounts
      .filter((row) => Boolean(row.billingTierId))
      .map((row) => [row.billingTierId as string, Number(row.count)]),
  )

  return snapshots.map((tier) => ({
    ...tier,
    subscriptionCount: countsByTierId.get(tier.id) ?? 0,
  }))
}

export async function getAdminBillingSnapshot(): Promise<AdminBillingSnapshot> {
  const [settings, currentTiers] = await Promise.all([
    getResolvedBillingSettings(),
    buildCurrentTiers(),
  ])

  return {
    billingEnabled: settings.billingEnabled,
    onboardingAllowanceUsd: settings.onboardingAllowanceUsd.toString(),
    overageThresholdDollars: settings.overageThresholdDollars.toString(),
    workflowExecutionChargeUsd: settings.workflowExecutionChargeUsd.toString(),
    functionExecutionChargeUsd: settings.functionExecutionChargeUsd.toString(),
    usageWarningThresholdPercent: settings.usageWarningThresholdPercent,
    freeTierUpgradeThresholdPercent: settings.freeTierUpgradeThresholdPercent,
    enterpriseContactUrl:
      settings.enterpriseContactUrl ??
      DEFAULT_BILLING_SETTINGS.enterpriseContactUrl,
    currentTiers,
  }
}
