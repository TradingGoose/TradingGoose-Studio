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
export type UsageAccrual = { currentUsageBefore: number; currentUsageAfter: number }

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
): Promise<UsageAccrual | null> {
  const { userId, workspaceId, workflowId, cost, extraUpdates = {}, reason } = params
  if (
    (!params.billingContext && !(await isBillingEnabledForRuntime())) ||
    (cost <= 0 && Object.keys(extraUpdates).length === 0)
  )
    return null

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
    const usage: UsageAccrual = { currentUsageBefore: 0, currentUsageAfter: 0 }
    // Lock every required ledger before changing either organization/member total.
    // The last target is the effective scope: the member ledger for individual organization usage.
    for (const target of targets) {
      const [row] = await tx
        .select({ currentPeriodCost: target.table.currentPeriodCost })
        .from(target.table)
        .where(target.where)
        .for('update')
      if (!row) {
        logger.warn('Usage cost accrual skipped - billing ledger record not found', {
          userId,
          workspaceId,
          workflowId,
          reason,
        })
        return null
      }
      usage.currentUsageBefore = Number(row.currentPeriodCost)
    }
    for (const target of targets) {
      const [updated] = await tx
        .update(target.table)
        .set({
          totalCost: sql`total_cost + ${cost}`,
          currentPeriodCost: sql`current_period_cost + ${cost}`,
          lastActive: new Date(),
          ...(organizationId ? { updatedAt: new Date() } : {}),
          ...extraUpdates,
        })
        .where(target.where)
        .returning({ currentPeriodCost: target.table.currentPeriodCost })
      usage.currentUsageAfter = Number(updated.currentPeriodCost)
    }
    return usage
  }
  const accrued = transaction ? await accrue(transaction) : await db.transaction(accrue)
  if (accrued && !params.skipThresholdBilling) {
    await checkAndBillOverageThreshold({ userId, workspaceId, workflowId })
  }
  return accrued
}
