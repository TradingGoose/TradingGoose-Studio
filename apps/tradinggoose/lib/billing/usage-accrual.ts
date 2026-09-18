import { db } from '@tradinggoose/db'
import {
  organizationBillingLedger,
  organizationMemberBillingLedger,
  userStats,
} from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
  type WorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BillingUsageAccrual')
export type UsageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function accrueUserUsageCost(
  params: {
    userId: string
    workspaceId?: string | null
    workflowId?: string | null
    cost: number
    extraUpdates?: Record<string, any>
    skipThresholdBilling?: boolean
    billingContext?: WorkspaceBillingContext
    reason: string
  },
  transaction?: UsageTransaction
): Promise<boolean> {
  const { userId, workspaceId, workflowId, cost, extraUpdates = {}, reason } = params
  if (
    (!params.billingContext && !(await isBillingEnabledForRuntime())) ||
    (cost <= 0 && Object.keys(extraUpdates).length === 0)
  )
    return false

  const context =
    params.billingContext ??
    (workflowId
      ? await resolveWorkflowBillingContext({ workflowId, actorUserId: userId })
      : workspaceId
        ? await resolveWorkspaceBillingContext({ workspaceId, actorUserId: userId })
        : null)
  const billingUserId = context?.billingUserId ?? userId
  const organizationId =
    context?.billingOwner.type === 'organization' ? context.billingOwner.organizationId : null
  const targets = organizationId
    ? [
        {
          table: organizationBillingLedger,
          where: eq(organizationBillingLedger.organizationId, organizationId),
        },
        ...(context?.scopeType === 'organization_member'
          ? [
              {
                table: organizationMemberBillingLedger,
                where: and(
                  eq(organizationMemberBillingLedger.organizationId, organizationId),
                  eq(organizationMemberBillingLedger.userId, billingUserId)
                ),
              },
            ]
          : []),
      ]
    : [{ table: userStats, where: eq(userStats.userId, billingUserId) }]

  const accrue = async (tx: UsageTransaction) => {
    // Lock every required ledger before changing either organization/member total.
    for (const target of targets) {
      const rows = await tx
        .select({ exists: sql`1` })
        .from(target.table)
        .where(target.where)
        .for('update')
      if (!rows.length) {
        logger.warn('Usage cost accrual skipped - billing ledger record not found', {
          userId,
          workspaceId,
          workflowId,
          reason,
        })
        return false
      }
    }
    for (const target of targets) {
      await tx
        .update(target.table)
        .set({
          totalCost: sql`total_cost + ${cost}`,
          currentPeriodCost: sql`current_period_cost + ${cost}`,
          lastActive: new Date(),
          ...(organizationId ? { updatedAt: new Date() } : {}),
          ...extraUpdates,
        })
        .where(target.where)
    }
    return true
  }
  const accrued = transaction ? await accrue(transaction) : await db.transaction(accrue)
  if (accrued && !params.skipThresholdBilling) {
    await checkAndBillOverageThreshold({ userId, workspaceId, workflowId })
  }
  return accrued
}
