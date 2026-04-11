import { db } from '@tradinggoose/db'
import { type subscription, systemBillingTier } from '@tradinggoose/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

export {
  canTierConfigureSso,
  canTierEditUsageLimit,
  EMPTY_BILLING_TIER_SUMMARY,
  getTierLogRetentionDays,
} from '@/lib/billing/tier-summary'

const logger = createLogger('BillingTiers')

export type BillingTierRecord = typeof systemBillingTier.$inferSelect
export type SubscriptionRecord = typeof subscription.$inferSelect
export type BillingReferenceType = SubscriptionRecord['referenceType']
export type SubscriptionWithTier = SubscriptionRecord & {
  tier: BillingTierRecord
}
export type BillingScopeType = BillingReferenceType | 'organization_member'
export interface BillingReference {
  referenceType: BillingReferenceType
  referenceId: string
}
export interface BillingScope {
  scopeType: BillingScopeType
  scopeId: string
  organizationId: string | null
  userId: string | null
}
export type OrganizationBillingTierRecord = BillingTierRecord & {
  ownerType: 'organization'
}
type SeatBillingTierRecord = OrganizationBillingTierRecord & {
  seatMode: 'adjustable'
}
export type OrganizationSubscriptionWithTier = SubscriptionWithTier & {
  tier: OrganizationBillingTierRecord
}

type SubscriptionScopeRecord = {
  referenceType: BillingReferenceType
  referenceId: string
  tier?: BillingTierRecord | null
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export function parseBillingAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
}

function parseOptionalBillingAmount(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : parseBillingAmount(value)
}

function parseBillingAmountWithFallback(
  value: string | number | null | undefined,
  fallback: number
): number {
  if (value === null || value === undefined) {
    return fallback
  }

  const parsed = Number.parseFloat(value.toString())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function isFreeBillingTier(tier: BillingTierRecord | null | undefined): boolean {
  return Boolean(
    tier &&
      parseBillingAmount(tier.monthlyPriceUsd) <= 0 &&
      parseBillingAmount(tier.yearlyPriceUsd) <= 0
  )
}

export function isPaidBillingTier(tier: BillingTierRecord | null | undefined): boolean {
  return Boolean(tier && !isFreeBillingTier(tier))
}

export function isOrganizationBillingTier(
  tier: BillingTierRecord | null | undefined
): tier is OrganizationBillingTierRecord {
  return tier?.ownerType === 'organization'
}

function isSeatBillingTier(
  tier: BillingTierRecord | null | undefined
): tier is SeatBillingTierRecord {
  return tier?.ownerType === 'organization' && tier?.seatMode === 'adjustable'
}

function usesSeatBasedBilling(tier: BillingTierRecord | null | undefined): boolean {
  return tier?.ownerType === 'organization'
}

export function usesIndividualBillingLedger(tier: BillingTierRecord | null | undefined): boolean {
  return Boolean(tier && tier.usageScope === 'individual')
}

export function getTierBasePrice(tier: BillingTierRecord | null | undefined): number {
  return parseBillingAmount(tier?.monthlyPriceUsd)
}

export function getTierIncludedUsageLimit(tier: BillingTierRecord | null | undefined): number {
  return parseBillingAmount(tier?.includedUsageLimitUsd)
}

export function getTierUsageAllowanceUsd(tier: BillingTierRecord | null | undefined): number {
  if (isDefined(tier?.includedUsageLimitUsd)) {
    return parseBillingAmount(tier.includedUsageLimitUsd)
  }

  return getTierBasePrice(tier)
}

export function getSubscriptionUsageAllowanceUsd(
  source:
    | BillingTierRecord
    | {
        seats?: number | null
        tier?: BillingTierRecord | null
      }
    | null
    | undefined
): number {
  const tier: BillingTierRecord | null | undefined =
    source && 'tier' in source ? source.tier : (source as BillingTierRecord | null | undefined)
  const seats = source && 'tier' in source ? Math.max(source.seats || 1, 1) : 1

  if (!tier) {
    return 0
  }

  if (usesSeatBasedBilling(tier)) {
    return seats * getTierUsageAllowanceUsd(tier)
  }

  return getTierUsageAllowanceUsd(tier)
}

export function getTierDisplayName(tier: BillingTierRecord | null | undefined): string {
  return tier?.displayName || 'Billing tier'
}

export function toBillingTierSummary(
  tier: BillingTierRecord | null | undefined
): BillingTierSummary {
  if (!tier) {
    return EMPTY_BILLING_TIER_SUMMARY
  }

  return {
    id: tier.id,
    displayName: tier.displayName,
    ownerType: tier.ownerType,
    usageScope: tier.usageScope,
    seatMode: tier.seatMode,
    displayOrder: tier.displayOrder,
    monthlyPriceUsd: parseOptionalBillingAmount(tier.monthlyPriceUsd),
    yearlyPriceUsd: parseOptionalBillingAmount(tier.yearlyPriceUsd),
    includedUsageLimitUsd: parseOptionalBillingAmount(tier.includedUsageLimitUsd),
    storageLimitGb: tier.storageLimitGb ?? null,
    concurrencyLimit: tier.concurrencyLimit ?? null,
    seatCount: tier.seatCount ?? null,
    seatMaximum: tier.seatMaximum ?? null,
    syncRateLimitPerMinute: tier.syncRateLimitPerMinute ?? null,
    asyncRateLimitPerMinute: tier.asyncRateLimitPerMinute ?? null,
    apiEndpointRateLimitPerMinute: tier.apiEndpointRateLimitPerMinute ?? null,
    canEditUsageLimit: tier.canEditUsageLimit,
    canConfigureSso: tier.canConfigureSso,
    logRetentionDays: tier.logRetentionDays ?? null,
    workflowModelCostMultiplier: parseBillingAmountWithFallback(
      tier.workflowModelCostMultiplier,
      1
    ),
    functionExecutionDurationMultiplier: parseBillingAmountWithFallback(
      tier.functionExecutionDurationMultiplier,
      0
    ),
    copilotCostMultiplier: parseBillingAmountWithFallback(tier.copilotCostMultiplier, 1),
    pricingFeatures: tier.pricingFeatures,
    isPublic: tier.isPublic,
    hasStripeMonthlyPriceId: Boolean(tier.stripeMonthlyPriceId),
  }
}

export function getTierRateLimits(tier: BillingTierRecord | null | undefined) {
  return {
    syncPerMinute: Math.max(tier?.syncRateLimitPerMinute ?? 0, 0),
    asyncPerMinute: Math.max(tier?.asyncRateLimitPerMinute ?? 0, 0),
    apiEndpointPerMinute: Math.max(tier?.apiEndpointRateLimitPerMinute ?? 0, 0),
  }
}

export function getTierWorkflowModelCostMultiplier(
  tier: BillingTierRecord | null | undefined
): number {
  return parseBillingAmountWithFallback(tier?.workflowModelCostMultiplier, 1)
}

export function getTierFunctionExecutionDurationMultiplier(
  tier: BillingTierRecord | null | undefined
): number {
  return parseBillingAmountWithFallback(tier?.functionExecutionDurationMultiplier, 0)
}

export function getTierCopilotCostMultiplier(tier: BillingTierRecord | null | undefined): number {
  return parseBillingAmountWithFallback(tier?.copilotCostMultiplier, 1)
}

function getSubscriptionDateValue(value: Date | null | undefined): number {
  return value instanceof Date ? value.getTime() : 0
}

function compareEffectiveSubscriptions(
  left: Pick<SubscriptionWithTier, 'tier' | 'periodStart' | 'periodEnd'>,
  right: Pick<SubscriptionWithTier, 'tier' | 'periodStart' | 'periodEnd'>
): number {
  const leftOwnerRank = left.tier.usageScope === 'pooled' ? 1 : 0
  const rightOwnerRank = right.tier.usageScope === 'pooled' ? 1 : 0

  if (leftOwnerRank !== rightOwnerRank) {
    return leftOwnerRank - rightOwnerRank
  }

  const periodEndDiff =
    getSubscriptionDateValue(left.periodEnd) - getSubscriptionDateValue(right.periodEnd)
  if (periodEndDiff !== 0) {
    return periodEndDiff
  }

  return getSubscriptionDateValue(left.periodStart) - getSubscriptionDateValue(right.periodStart)
}

export function selectEffectiveSubscription<T extends SubscriptionWithTier>(
  subscriptions: T[]
): T | null {
  return subscriptions.reduce<T | null>((effectiveSubscription, candidate) => {
    if (!effectiveSubscription) {
      return candidate
    }

    return compareEffectiveSubscriptions(candidate, effectiveSubscription) > 0
      ? candidate
      : effectiveSubscription
  }, null)
}

export function isOrganizationSubscription(
  subscriptionRecord: { tier?: BillingTierRecord | null } | null | undefined
): subscriptionRecord is OrganizationSubscriptionWithTier {
  return Boolean(subscriptionRecord?.tier && isOrganizationBillingTier(subscriptionRecord.tier))
}

export function getSubscriptionBillingScope(
  individualUserId: string,
  subscriptionRecord: SubscriptionScopeRecord | null | undefined
): BillingScope {
  if (subscriptionRecord?.tier?.usageScope === 'pooled' && subscriptionRecord.referenceId) {
    return {
      scopeId: subscriptionRecord.referenceId,
      scopeType: subscriptionRecord.referenceType,
      organizationId:
        subscriptionRecord.referenceType === 'organization' ? subscriptionRecord.referenceId : null,
      userId: null,
    }
  }

  if (subscriptionRecord?.referenceType === 'organization' && subscriptionRecord.referenceId) {
    return {
      scopeId: `${subscriptionRecord.referenceId}:${individualUserId}`,
      scopeType: 'organization_member',
      organizationId: subscriptionRecord.referenceId,
      userId: individualUserId,
    }
  }

  return {
    scopeId: individualUserId,
    scopeType: 'user',
    organizationId: null,
    userId: individualUserId,
  }
}

export async function requireBillingTierById(id: string): Promise<BillingTierRecord> {
  const rows = await db
    .select()
    .from(systemBillingTier)
    .where(eq(systemBillingTier.id, id))
    .limit(1)

  const tier = rows[0] ?? null
  if (!tier) {
    throw new Error(`Billing tier not found: ${id}`)
  }

  return tier
}

export async function getDefaultBillingTier(): Promise<BillingTierRecord | null> {
  const rows = await db
    .select()
    .from(systemBillingTier)
    .where(
      and(
        eq(systemBillingTier.status, 'active'),
        eq(systemBillingTier.isDefault, true),
        eq(systemBillingTier.isPublic, true),
        eq(systemBillingTier.ownerType, 'user'),
        eq(systemBillingTier.usageScope, 'individual'),
        eq(systemBillingTier.seatMode, 'fixed'),
        sql`coalesce(${systemBillingTier.monthlyPriceUsd}, '0')::numeric = 0`,
        sql`coalesce(${systemBillingTier.yearlyPriceUsd}, '0')::numeric = 0`
      )
    )
    .orderBy(asc(systemBillingTier.displayOrder))
    .limit(1)

  return rows[0] ?? null
}

export async function requireDefaultBillingTier(): Promise<BillingTierRecord> {
  const tier = await getDefaultBillingTier()
  if (!tier) {
    throw new Error('No active default billing tier configured')
  }

  return tier
}

export async function getPublicBillingTiers(): Promise<BillingTierRecord[]> {
  return db
    .select()
    .from(systemBillingTier)
    .where(and(eq(systemBillingTier.status, 'active'), eq(systemBillingTier.isPublic, true)))
    .orderBy(asc(systemBillingTier.displayOrder))
}

export async function getPrimaryPublicUserUpgradeTier(): Promise<BillingTierRecord | null> {
  const tiers = await getPublicBillingTiers()
  const tier = tiers.find(
    (candidate) => candidate.ownerType === 'user' && candidate.usageScope === 'individual' && !isFreeBillingTier(candidate)
  )
  return tier ?? null
}

export async function getAllBillingTiers(): Promise<BillingTierRecord[]> {
  return db.select().from(systemBillingTier).orderBy(asc(systemBillingTier.displayOrder))
}

export async function getHiddenEnterprisePlaceholderTier(): Promise<BillingTierRecord | null> {
  const rows = await db
    .select()
    .from(systemBillingTier)
    .where(
      and(
        eq(systemBillingTier.status, 'active'),
        eq(systemBillingTier.isPublic, false),
        eq(systemBillingTier.ownerType, 'organization')
      )
    )
    .orderBy(asc(systemBillingTier.displayOrder))
    .limit(1)

  return rows[0] ?? null
}

export async function hydrateSubscriptionsWithTiers(
  subscriptions: SubscriptionRecord[]
): Promise<SubscriptionWithTier[]> {
  const tierIds = [
    ...new Set(
      subscriptions
        .map((row) => row.billingTierId)
        .filter((tierId): tierId is string => Boolean(tierId))
    ),
  ]

  if (tierIds.length === 0) {
    return []
  }

  const tiers = await db
    .select()
    .from(systemBillingTier)
    .where(inArray(systemBillingTier.id, tierIds))

  const tiersById = new Map(tiers.map((tier) => [tier.id, tier]))

  return subscriptions.flatMap((subscriptionRecord) => {
    if (!subscriptionRecord.billingTierId) {
      logger.error('Active subscription missing billingTierId', {
        subscriptionId: subscriptionRecord.id,
        referenceType: subscriptionRecord.referenceType,
        referenceId: subscriptionRecord.referenceId,
      })
      return []
    }

    const tier = tiersById.get(subscriptionRecord.billingTierId)
    if (!tier) {
      logger.error('Active subscription billing tier not found', {
        subscriptionId: subscriptionRecord.id,
        billingTierId: subscriptionRecord.billingTierId,
      })
      return []
    }

    if (subscriptionRecord.referenceType !== tier.ownerType) {
      logger.error('Subscription ownership does not match billing tier owner type', {
        subscriptionId: subscriptionRecord.id,
        billingTierId: subscriptionRecord.billingTierId,
        referenceType: subscriptionRecord.referenceType,
        tierOwnerType: tier.ownerType,
      })
      return []
    }

    return [{ ...subscriptionRecord, tier }]
  })
}
