import {
  assertFinancialMemberTargets,
  FinancialPolicyError,
  lockFinancialRoots,
  readFinancialMemberTarget,
} from '@tradinggoose/billing'
import {
  addMoney,
  compareMoney,
  type DecimalAmount,
  decimalFromSafeInteger,
  displayPercentage,
  maxMoney,
  monetary,
  multiplyMoney,
} from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import {
  member,
  organization,
  organizationBillingLedger,
  organizationMemberBillingLedger,
  user,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import {
  canTierEditUsageLimit,
  getSubscriptionUsageAllowanceUsd,
  getTierUsageAllowanceUsd,
  toBillingTierSummary,
} from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationBilling')

function parseLedgerNumber(value: string | null | undefined): DecimalAmount {
  return monetary(value)
}

export interface OrganizationBillingLedgerSnapshot {
  organizationId: string
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  totalTokensUsed: number
  totalCost: DecimalAmount
  currentPeriodCost: DecimalAmount
  lastPeriodCost: DecimalAmount
  billedOverageThisPeriod: DecimalAmount
  totalCopilotCost: DecimalAmount
  currentPeriodCopilotCost: DecimalAmount
  lastPeriodCopilotCost: DecimalAmount
  totalCopilotTokens: number
  totalCopilotCalls: number
  billingBlocked: boolean
  lastActive: Date
  createdAt: Date
  updatedAt: Date
}

export interface OrganizationMemberBillingLedgerSnapshot {
  organizationId: string
  userId: string
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  totalTokensUsed: number
  totalCost: DecimalAmount
  currentPeriodCost: DecimalAmount
  lastPeriodCost: DecimalAmount
  totalCopilotCost: DecimalAmount
  currentPeriodCopilotCost: DecimalAmount
  lastPeriodCopilotCost: DecimalAmount
  totalCopilotTokens: number
  totalCopilotCalls: number
  lastActive: Date
  createdAt: Date
  updatedAt: Date
}

export async function getOrganizationBillingLedger(
  organizationId: string
): Promise<OrganizationBillingLedgerSnapshot | null> {
  return db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [{ type: 'organization', id: organizationId }])
    const organizationRows = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (organizationRows.length === 0) {
      return null
    }

    const ledgerRows = await tx
      .select()
      .from(organizationBillingLedger)
      .where(eq(organizationBillingLedger.organizationId, organizationId))
      .limit(1)

    if (ledgerRows.length === 0)
      throw new FinancialPolicyError('Original financial ledger is missing; preservation required')

    return mapOrganizationBillingLedgerRow(ledgerRows[0])
  })
}

function mapOrganizationBillingLedgerRow(
  row: typeof organizationBillingLedger.$inferSelect
): OrganizationBillingLedgerSnapshot {
  return {
    organizationId: row.organizationId,
    totalManualExecutions: row.totalManualExecutions,
    totalApiCalls: row.totalApiCalls,
    totalWebhookTriggers: row.totalWebhookTriggers,
    totalScheduledExecutions: row.totalScheduledExecutions,
    totalChatExecutions: row.totalChatExecutions,
    totalTokensUsed: row.totalTokensUsed,
    totalCost: parseLedgerNumber(row.totalCost),
    currentPeriodCost: parseLedgerNumber(row.currentPeriodCost),
    lastPeriodCost: parseLedgerNumber(row.lastPeriodCost),
    billedOverageThisPeriod: parseLedgerNumber(row.billedOverageThisPeriod),
    totalCopilotCost: parseLedgerNumber(row.totalCopilotCost),
    currentPeriodCopilotCost: parseLedgerNumber(row.currentPeriodCopilotCost),
    lastPeriodCopilotCost: parseLedgerNumber(row.lastPeriodCopilotCost),
    totalCopilotTokens: row.totalCopilotTokens,
    totalCopilotCalls: row.totalCopilotCalls,
    billingBlocked: row.billingBlocked,
    lastActive: row.lastActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getOrganizationMemberBillingLedger(
  organizationId: string,
  userId: string
): Promise<OrganizationMemberBillingLedgerSnapshot | null> {
  return db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [{ type: 'organization', id: organizationId }])
    await readFinancialMemberTarget(tx, organizationId, userId)
    const ledgerRows = await tx
      .select()
      .from(organizationMemberBillingLedger)
      .where(
        and(
          eq(organizationMemberBillingLedger.organizationId, organizationId),
          eq(organizationMemberBillingLedger.userId, userId)
        )
      )
      .limit(1)

    if (ledgerRows.length === 0)
      throw new FinancialPolicyError('Original financial member target is missing')

    return mapOrganizationMemberBillingLedgerRow(ledgerRows[0])
  })
}

export async function getOrganizationMemberBillingLedgers(
  organizationId: string
): Promise<OrganizationMemberBillingLedgerSnapshot[]> {
  return db.transaction(async (tx) => {
    await assertFinancialMemberTargets(tx, organizationId)
    const rows = await tx
      .select()
      .from(organizationMemberBillingLedger)
      .where(eq(organizationMemberBillingLedger.organizationId, organizationId))
    return rows.map(mapOrganizationMemberBillingLedgerRow)
  })
}

function mapOrganizationMemberBillingLedgerRow(
  row: typeof organizationMemberBillingLedger.$inferSelect
): OrganizationMemberBillingLedgerSnapshot {
  return {
    organizationId: row.organizationId,
    userId: row.userId,
    totalManualExecutions: row.totalManualExecutions,
    totalApiCalls: row.totalApiCalls,
    totalWebhookTriggers: row.totalWebhookTriggers,
    totalScheduledExecutions: row.totalScheduledExecutions,
    totalChatExecutions: row.totalChatExecutions,
    totalTokensUsed: row.totalTokensUsed,
    totalCost: parseLedgerNumber(row.totalCost),
    currentPeriodCost: parseLedgerNumber(row.currentPeriodCost),
    lastPeriodCost: parseLedgerNumber(row.lastPeriodCost),
    totalCopilotCost: parseLedgerNumber(row.totalCopilotCost),
    currentPeriodCopilotCost: parseLedgerNumber(row.currentPeriodCopilotCost),
    lastPeriodCopilotCost: parseLedgerNumber(row.lastPeriodCopilotCost),
    totalCopilotTokens: row.totalCopilotTokens,
    totalCopilotCalls: row.totalCopilotCalls,
    lastActive: row.lastActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export interface OrganizationUsageData {
  organizationId: string
  organizationName: string
  subscriptionTier: BillingTierSummary | null
  subscriptionStatus: string | null
  seatPriceUsd: DecimalAmount | null
  seatCount: number | null
  seatMaximum: number | null
  seatMode: 'fixed' | 'adjustable' | null
  totalSeats: number
  usedSeats: number
  seatsCount: number
  totalCurrentUsage: DecimalAmount
  totalUsageLimit: DecimalAmount | null
  warningThresholdPercent: number
  minimumUsageLimit: DecimalAmount
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  currentPeriodCost: DecimalAmount
  lastPeriodCost: DecimalAmount
  billedOverageThisPeriod: DecimalAmount
  currentPeriodCopilotCost: DecimalAmount
  lastPeriodCopilotCost: DecimalAmount
  totalCost: DecimalAmount
  totalCopilotCost: DecimalAmount
  billingBlocked: boolean
  members: MemberUsageData[]
}
export interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: DecimalAmount | null
  usageLimit: DecimalAmount | null
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: Date
  lastActive: Date | null
}
export function getOrganizationMinimumUsageLimitUsd(
  subscription: Awaited<ReturnType<typeof getOrganizationSubscription>> | null
): DecimalAmount {
  return subscription ? getSubscriptionUsageAllowanceUsd(subscription) : '0'
}

export async function getOrganizationBillingData(
  organizationId: string
): Promise<OrganizationUsageData | null> {
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!org) return null
  const [{ billingEnabled, usageWarningThresholdPercent }, active, ledger] = await Promise.all([
    getResolvedBillingSettings(),
    getOrganizationSubscription(organizationId),
    getOrganizationBillingLedger(organizationId),
  ])
  const subscription = billingEnabled ? active : null
  const people = await db
    .select({
      userId: member.userId,
      userName: user.name,
      userEmail: user.email,
      role: member.role,
      joinedAt: member.createdAt,
      lastActive: userStats.lastActive,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))
  const memberLedgers = await getOrganizationMemberBillingLedgers(organizationId)
  if (!ledger) throw new FinancialPolicyError('Original organization financial ledger is missing')
  const individual = subscription?.tier.usageScope === 'individual'
  const byUser = new Map(memberLedgers.map((row) => [row.userId, row]))
  const members: MemberUsageData[] = people.map((person) => {
    const money = byUser.get(person.userId)?.currentPeriodCost ?? null
    const limit = !billingEnabled
      ? null
      : individual
        ? getTierUsageAllowanceUsd(subscription?.tier)
        : '0'
    return {
      ...person,
      currentUsage: individual || !subscription ? money : null,
      usageLimit: limit,
      percentUsed: money !== null && limit !== null ? displayPercentage(money, limit) : 0,
      isOverLimit:
        billingEnabled &&
        (!subscription || individual) &&
        (money === null || (limit !== null && compareMoney(money, limit) > 0)),
    }
  })
  const totalCurrentUsage =
    individual && memberLedgers.length
      ? addMoney(...memberLedgers.map((row) => row.currentPeriodCost))
      : ledger.currentPeriodCost
  const minimumUsageLimit = subscription ? getOrganizationMinimumUsageLimitUsd(subscription) : '0'
  const totalUsageLimit = !billingEnabled
    ? null
    : !subscription
      ? '0'
      : individual
        ? addMoney(...members.map((row) => row.usageLimit ?? '0'))
        : org.orgUsageLimit === null
          ? minimumUsageLimit
          : maxMoney(monetary(org.orgUsageLimit), minimumUsageLimit)
  const percentUsed =
    totalUsageLimit === null ? 0 : displayPercentage(totalCurrentUsage, totalUsageLimit)
  const isExceeded =
    billingEnabled &&
    (ledger.billingBlocked ||
      (totalUsageLimit !== null && compareMoney(totalCurrentUsage, totalUsageLimit) >= 0))
  const isWarning =
    billingEnabled &&
    totalUsageLimit !== null &&
    compareMoney(
      multiplyMoney(totalCurrentUsage, '100'),
      multiplyMoney(totalUsageLimit, decimalFromSafeInteger(usageWarningThresholdPercent))
    ) >= 0
  const seats = subscription?.seats ?? subscription?.tier.seatCount ?? people.length
  if (!Number.isSafeInteger(seats) || seats < 0)
    throw new FinancialPolicyError('Organization seat quantity is invalid')
  return {
    organizationId,
    organizationName: org.name,
    subscriptionTier: subscription ? toBillingTierSummary(subscription.tier) : null,
    subscriptionStatus: subscription?.status ?? null,
    seatPriceUsd:
      subscription?.tier.monthlyPriceUsd === null || !subscription
        ? null
        : monetary(subscription.tier.monthlyPriceUsd),
    seatCount: subscription?.tier.seatCount ?? null,
    seatMaximum: subscription?.tier.seatMaximum ?? null,
    seatMode: subscription?.tier.seatMode ?? null,
    totalSeats: seats,
    usedSeats: people.length,
    seatsCount: seats,
    totalCurrentUsage,
    totalUsageLimit,
    warningThresholdPercent: billingEnabled ? usageWarningThresholdPercent : 0,
    minimumUsageLimit,
    percentUsed,
    isWarning,
    isExceeded,
    billingPeriodStart: subscription?.periodStart ?? null,
    billingPeriodEnd: subscription?.periodEnd ?? null,
    currentPeriodCost: ledger.currentPeriodCost,
    lastPeriodCost: ledger.lastPeriodCost,
    billedOverageThisPeriod: ledger.billedOverageThisPeriod,
    currentPeriodCopilotCost: ledger.currentPeriodCopilotCost,
    lastPeriodCopilotCost: ledger.lastPeriodCopilotCost,
    totalCost: ledger.totalCost,
    totalCopilotCost: ledger.totalCopilotCost,
    billingBlocked: ledger.billingBlocked,
    members: members.sort((a, b) =>
      a.currentUsage === null
        ? 1
        : b.currentUsage === null
          ? -1
          : compareMoney(b.currentUsage, a.currentUsage)
    ),
  }
}

export async function updateOrganizationUsageLimit(
  organizationId: string,
  newLimit: DecimalAmount,
  actorUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const limit = monetary(newLimit)
    return await db.transaction(async (tx) => {
      await lockFinancialRoots(tx, [{ type: 'organization', id: organizationId }])
      const [actor] = await tx
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, actorUserId)))
        .limit(1)
      if (actor?.role !== 'owner')
        throw new FinancialPolicyError('Current organization owner authorization required', 403)
      const subscription = await getOrganizationSubscription(organizationId)
      if (!subscription) return { success: false, error: 'No active subscription found' }
      if (!canTierEditUsageLimit(subscription.tier))
        return { success: false, error: 'This tier does not allow usage limit changes' }
      if (subscription.tier.usageScope === 'individual')
        return {
          success: false,
          error: 'Organization-level usage caps are only available for pooled billing tiers',
        }
      const minimum = getOrganizationMinimumUsageLimitUsd(subscription)
      if (compareMoney(limit, minimum) < 0)
        return {
          success: false,
          error: `Usage limit cannot be less than the minimum included allowance of $${minimum}`,
        }
      await tx
        .update(organization)
        .set({ orgUsageLimit: limit, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))
      return { success: true }
    })
  } catch (error) {
    logger.error('Failed to update organization usage limit', { organizationId, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update usage limit',
    }
  }
}

/**
 * Check if a user is an owner or admin of a specific organization
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization
 * @returns Promise<boolean> - True if the user is an owner or admin of the organization
 */
export async function isOrganizationOwnerOrAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  try {
    const memberRecord = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (memberRecord.length === 0) {
      return false
    }

    const userRole = memberRecord[0].role
    return ['owner', 'admin'].includes(userRole)
  } catch (error) {
    logger.error('Error checking organization ownership/admin status:', error)
    return false
  }
}
