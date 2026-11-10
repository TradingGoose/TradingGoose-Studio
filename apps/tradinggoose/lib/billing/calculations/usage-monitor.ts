import { FinancialPolicyError } from '@tradinggoose/billing'
import { compareMoney, type DecimalAmount, maxMoney, monetary } from '@tradinggoose/billing/money'
import { db } from '@tradinggoose/db'
import { organization, userStats } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  getOrganizationBillingLedger,
  getOrganizationMemberBillingLedger,
} from '@/lib/billing/core/organization'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { getSubscriptionUsageAllowanceUsd, getTierUsageAllowanceUsd } from '@/lib/billing/tiers'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UsageMonitor')
type UsageLimitStatus = {
  isExceeded: boolean
  currentUsage: DecimalAmount | null
  limit: DecimalAmount | null
  message?: string
}
const blocked = (currentUsage: DecimalAmount): UsageLimitStatus => ({
  isExceeded: true,
  currentUsage,
  limit: null,
  message: 'Billing issue detected. Please update your payment method to continue.',
})
const knownStatus = (
  currentUsage: DecimalAmount,
  limit: DecimalAmount | null
): UsageLimitStatus => {
  const isExceeded = limit !== null && compareMoney(currentUsage, limit) >= 0
  return {
    currentUsage,
    limit,
    isExceeded,
    ...(isExceeded
      ? {
          message: `Usage limit exceeded: $${currentUsage} used of $${limit}. Please upgrade your billing tier to continue.`,
        }
      : {}),
  }
}

/** Coarse request preflight; actual contacts also require the canonical locked financial admission. */
export async function checkServerSideUsageLimits(params: {
  userId: string
  workspaceId?: string | null
  workflowId?: string | null
}): Promise<UsageLimitStatus> {
  const { userId, workspaceId = null, workflowId = null } = params
  try {
    const { billingEnabled } = await getResolvedBillingSettings()
    if (!billingEnabled) return { isExceeded: false, currentUsage: null, limit: null }
    const context = workflowId
      ? await resolveWorkflowBillingContext({ workflowId, actorUserId: userId })
      : workspaceId
        ? await resolveWorkspaceBillingContext({ workspaceId, actorUserId: userId })
        : null
    if (context?.billingOwner.type === 'organization') {
      const organizationId = context.billingOwner.organizationId
      const ledger = await getOrganizationBillingLedger(organizationId)
      if (!ledger)
        throw new FinancialPolicyError('Original financial organization ledger is missing')
      if (context.scopeType === 'organization_member') {
        const target = await getOrganizationMemberBillingLedger(
          organizationId,
          context.billingUserId
        )
        if (!target) throw new FinancialPolicyError('Original financial member ledger is missing')
        return ledger.billingBlocked
          ? blocked(target.currentPeriodCost)
          : knownStatus(
              target.currentPeriodCost,
              getTierUsageAllowanceUsd(context.subscription?.tier ?? context.tier)
            )
      }
      const [org] = await db
        .select({ limit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)
      if (!org) throw new FinancialPolicyError('Original financial organization is missing')
      const included = getSubscriptionUsageAllowanceUsd(context.subscription ?? context.tier)
      const limit = org.limit === null ? included : maxMoney(monetary(org.limit), included)
      return ledger.billingBlocked
        ? blocked(ledger.currentPeriodCost)
        : knownStatus(ledger.currentPeriodCost, limit)
    }
    const [usage, records] = await Promise.all([
      getUserUsageData(userId),
      db
        .select({ blocked: userStats.billingBlocked })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),
    ])
    if (!records[0]) throw new FinancialPolicyError('Original user financial ledger is missing')
    return records[0].blocked
      ? blocked(usage.currentUsage)
      : knownStatus(usage.currentUsage, usage.limit)
  } catch (error) {
    logger.error('Cannot determine usage limits; blocking contact', { userId, error })
    return {
      isExceeded: true,
      currentUsage: null,
      limit: null,
      message:
        'Unable to determine usage limits. Execution blocked until billing is configured correctly.',
    }
  }
}
