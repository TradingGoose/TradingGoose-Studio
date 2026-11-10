import { FinancialPolicyError, financialNamespace, lockFinancialRoots } from '@tradinggoose/billing'
import {
  compareMoney,
  type DecimalAmount,
  decimalFromSafeInteger,
  displayPercentage,
  monetary,
  multiplyMoney,
} from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { idempotencyKey, member, user, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getConfiguredPersonalUsageLimit,
  getEffectiveSubscription,
  getPersonalEffectiveSubscription,
  getSubscribedPersonalUsageMinimumLimit,
} from '@/lib/billing/core/subscription'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import { toBillingTierSummary } from '@/lib/billing/tiers'
import type { UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UsageManagement')

/** Explicit new-user provisioning grants once; readers never reconstruct missing financial rows. */
export async function handleNewUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFinancialRoots(tx, [{ type: 'user', id: userId }])
    const [existing] = await tx
      .select({ id: userStats.id })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)
    if (existing) return
    const [evidence] = await tx
      .select({ key: idempotencyKey.key })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.namespace, financialNamespace({ type: 'user', id: userId })))
      .limit(1)
    if (evidence) throw new FinancialPolicyError('Historical financial target cannot be recreated')
    const { onboardingAllowanceUsd } = await getResolvedBillingSettings(tx)
    await tx.insert(userStats).values({
      id: crypto.randomUUID(),
      userId,
      grantedOnboardingAllowanceUsd: onboardingAllowanceUsd,
      customUsageLimit: onboardingAllowanceUsd,
    })
  })
}

export async function getUserUsageData(userId: string): Promise<UsageData> {
  const [{ billingEnabled, usageWarningThresholdPercent }, records, subscription] =
    await Promise.all([
      getResolvedBillingSettings(),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
      getEffectiveSubscription(userId),
    ])
  const stats = records[0]
  if (!stats) throw new FinancialPolicyError('Original user financial ledger is missing')
  const lastPeriodCost = monetary(stats.lastPeriodCost)
  if (!billingEnabled)
    return {
      currentUsage: monetary(stats.totalCost),
      limit: null,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost,
    }
  if (!subscription)
    throw new FinancialPolicyError('No active personal subscription found for billed user')
  const currentUsage = monetary(stats.currentPeriodCost)
  const minimum = getSubscribedPersonalUsageMinimumLimit({
    subscription,
    grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
  })
  const limit = getConfiguredPersonalUsageLimit(stats.customUsageLimit, minimum)
  return {
    currentUsage,
    limit,
    percentUsed: displayPercentage(currentUsage, limit),
    isWarning:
      compareMoney(
        multiplyMoney(currentUsage, '100'),
        multiplyMoney(limit, decimalFromSafeInteger(usageWarningThresholdPercent))
      ) >= 0,
    isExceeded: compareMoney(currentUsage, limit) >= 0,
    billingPeriodStart: subscription.periodStart,
    billingPeriodEnd: subscription.periodEnd,
    lastPeriodCost,
  }
}

export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  const [{ billingEnabled }, subscription, rows] = await Promise.all([
    getResolvedBillingSettings(),
    getEffectiveSubscription(userId),
    db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
  ])
  const stats = rows[0]
  if (!stats) throw new FinancialPolicyError('Original user financial ledger is missing')
  if (!billingEnabled)
    return {
      currentLimit: null,
      canEdit: false,
      minimumLimit: '0',
      tier: toBillingTierSummary(null),
      updatedAt: stats.customUsageLimitUpdatedAt,
    }
  if (!subscription)
    throw new FinancialPolicyError('No active personal subscription found for billed user')
  const minimumLimit = getSubscribedPersonalUsageMinimumLimit({
    subscription,
    grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
  })
  return {
    currentLimit: getConfiguredPersonalUsageLimit(stats.customUsageLimit, minimumLimit),
    canEdit: canEditUsageLimit(subscription),
    minimumLimit,
    tier: toBillingTierSummary(subscription.tier),
    updatedAt: stats.customUsageLimitUpdatedAt,
  }
}

export async function updateUserUsageLimit(
  userId: string,
  newLimit: DecimalAmount,
  setBy?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const limit = monetary(newLimit)
    return await db.transaction(async (tx) => {
      await lockFinancialRoots(tx, [{ type: 'user', id: userId }])
      if (setBy && setBy !== userId)
        throw new FinancialPolicyError('Authenticated personal owner required', 403)
      const subscription = await getPersonalEffectiveSubscription(userId, tx)
      if (!canEditUsageLimit(subscription))
        return { success: false, error: 'This billing tier cannot edit usage limits' }
      const [stats] = await tx.select().from(userStats).where(eq(userStats.userId, userId)).limit(1)
      if (!stats) throw new FinancialPolicyError('Original user financial ledger is missing')
      const minimum = getSubscribedPersonalUsageMinimumLimit({
        subscription,
        grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
      })
      if (compareMoney(limit, minimum) < 0)
        return {
          success: false,
          error: `Usage limit cannot be below the billing tier minimum of $${minimum}`,
        }
      if (compareMoney(limit, monetary(stats.currentPeriodCost)) < 0)
        return {
          success: false,
          error: `Usage limit cannot be below current usage of $${monetary(stats.currentPeriodCost)}`,
        }
      await tx
        .update(userStats)
        .set({ customUsageLimit: limit, customUsageLimitUpdatedAt: new Date() })
        .where(eq(userStats.userId, userId))
      return { success: true }
    })
  } catch (error) {
    logger.error('Failed to update usage limit', { userId, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update usage limit',
    }
  }
}

export async function getUserUsageLimit(userId: string): Promise<DecimalAmount | null> {
  return (await getUserUsageLimitInfo(userId)).currentLimit
}

export async function checkUsageStatus(userId: string) {
  const usageData = await getUserUsageData(userId)
  return {
    status: usageData.isExceeded
      ? ('exceeded' as const)
      : usageData.isWarning
        ? ('warning' as const)
        : ('ok' as const),
    usageData,
  }
}

export async function getTeamUsageLimits(organizationId: string) {
  const rows = await db
    .select({
      userId: member.userId,
      userName: user.name,
      userEmail: user.email,
      currentLimit: userStats.customUsageLimit,
      currentUsage: userStats.currentPeriodCost,
      totalCost: userStats.totalCost,
      lastActive: userStats.lastActive,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))
  return rows.map((row) => ({
    ...row,
    currentLimit: row.currentLimit === null ? null : monetary(row.currentLimit),
    currentUsage: monetary(row.currentUsage),
    totalCost: monetary(row.totalCost),
  }))
}

export async function getEffectiveCurrentPeriodCost(userId: string): Promise<DecimalAmount> {
  const [row] = await db
    .select({ current: userStats.currentPeriodCost })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)
  if (!row) throw new FinancialPolicyError('Original user financial ledger is missing')
  return monetary(row.current)
}
