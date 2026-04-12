import { db } from '@tradinggoose/db'
import { organizationBillingLedger, organizationMemberBillingLedger, userStats } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  getOrganizationBillingLedger,
  getOrganizationMemberBillingLedger,
} from '@/lib/billing/core/organization'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingUsageAccrual')

export async function accrueUserUsageCost(params: {
  userId: string
  workspaceId?: string | null
  workflowId?: string | null
  cost: number
  extraUpdates?: Record<string, any>
  skipThresholdBilling?: boolean
  reason: string
}): Promise<boolean> {
  const {
    userId,
    workspaceId,
    workflowId,
    cost,
    extraUpdates = {},
    skipThresholdBilling = false,
    reason,
  } = params

  if (!(await isBillingEnabledForRuntime()) || cost <= 0) {
    return false
  }

  const billingContext = workflowId
    ? await resolveWorkflowBillingContext({ workflowId, actorUserId: userId })
    : workspaceId
      ? await resolveWorkspaceBillingContext({ workspaceId, actorUserId: userId })
      : null

  const billingScopeType = billingContext?.scopeType ?? 'user'
  const billingScopeId = billingContext?.scopeId ?? userId
  const billingUserId = billingContext?.billingUserId ?? userId

  if (billingScopeType === 'organization') {
    const billingLedger = await getOrganizationBillingLedger(billingScopeId)
    if (!billingLedger) {
      logger.warn('Usage cost accrual skipped - organization ledger record not found', {
        actorUserId: userId,
        billingScopeId,
        workspaceId,
        workflowId,
        reason,
      })
      return false
    }

    await db
      .update(organizationBillingLedger)
      .set({
        totalCost: sql`total_cost + ${cost}`,
        currentPeriodCost: sql`current_period_cost + ${cost}`,
        lastActive: new Date(),
        updatedAt: new Date(),
        ...extraUpdates,
      })
      .where(eq(organizationBillingLedger.organizationId, billingScopeId))
  } else if (
    billingScopeType === 'organization_member' &&
    billingContext?.billingOwner.type === 'organization'
  ) {
    const organizationId = billingContext.billingOwner.organizationId
    const [organizationLedger, memberLedger] = await Promise.all([
      getOrganizationBillingLedger(organizationId),
      getOrganizationMemberBillingLedger(organizationId, billingUserId),
    ])

    if (!organizationLedger || !memberLedger) {
      logger.warn('Usage cost accrual skipped - organization member ledger record not found', {
        actorUserId: userId,
        billingUserId,
        organizationId,
        workspaceId,
        workflowId,
        reason,
      })
      return false
    }

    await Promise.all([
      db
        .update(organizationMemberBillingLedger)
        .set({
          totalCost: sql`total_cost + ${cost}`,
          currentPeriodCost: sql`current_period_cost + ${cost}`,
          lastActive: new Date(),
          updatedAt: new Date(),
          ...extraUpdates,
        })
        .where(
          and(
            eq(organizationMemberBillingLedger.organizationId, organizationId),
            eq(organizationMemberBillingLedger.userId, billingUserId)
          )
        ),
      db
        .update(organizationBillingLedger)
        .set({
          totalCost: sql`total_cost + ${cost}`,
          currentPeriodCost: sql`current_period_cost + ${cost}`,
          lastActive: new Date(),
          updatedAt: new Date(),
          ...extraUpdates,
        })
        .where(eq(organizationBillingLedger.organizationId, organizationId)),
    ])
  } else {
    const statsRows = await db
      .select({ id: userStats.id })
      .from(userStats)
      .where(eq(userStats.userId, billingUserId))
      .limit(1)

    if (statsRows.length === 0) {
      logger.warn('Usage cost accrual skipped - user stats record not found', {
        actorUserId: userId,
        billingUserId,
        workspaceId,
        workflowId,
        reason,
      })
      return false
    }

    await db
      .update(userStats)
      .set({
        totalCost: sql`total_cost + ${cost}`,
        currentPeriodCost: sql`current_period_cost + ${cost}`,
        lastActive: new Date(),
        ...extraUpdates,
      })
      .where(eq(userStats.userId, billingUserId))
  }

  if (!skipThresholdBilling) {
    await checkAndBillOverageThreshold({
      userId,
      workspaceId,
      workflowId,
    })
  }

  logger.info('Accrued usage cost', {
    actorUserId: userId,
    billingUserId,
    billingScopeType,
    billingScopeId,
    workspaceId,
    workflowId,
    cost,
    reason,
  })

  return true
}
