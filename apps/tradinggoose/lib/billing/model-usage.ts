import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  getTierCopilotCostMultiplier,
  getTierWorkflowModelCostMultiplier,
} from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import type { NativeCost, NativeUsage } from '@/lib/mastra/usage'

export interface ModelUsageScope {
  actorUserId: string
  funding: 'byok' | 'account'
  workspaceId?: string | null
  workflowId?: string | null
  executionId?: string
  runId: string
  model: string
  purpose: string
  signal?: AbortSignal
}

function resolveModelBillingContext(scope: ModelUsageScope) {
  return scope.workflowId
    ? resolveWorkflowBillingContext({
        workflowId: scope.workflowId,
        actorUserId: scope.actorUserId,
      })
    : resolveWorkspaceBillingContext({
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
      })
}

export async function assertModelUsageAllowed(scope: ModelUsageScope) {
  scope.signal?.throwIfAborted()
  if (scope.funding === 'byok') return
  const billingEnabled = await isBillingEnabledForRuntime()
  scope.signal?.throwIfAborted()
  if (!billingEnabled) return
  const billingContext = await resolveModelBillingContext(scope)
  scope.signal?.throwIfAborted()
  const status = await checkServerSideUsageLimits({
    userId: billingContext.billingUserId,
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
  })
  if (status.isExceeded)
    throw Object.assign(new Error(status.message ?? 'Usage allowance exhausted'), { status: 402 })
  scope.signal?.throwIfAborted()
}

/** Active workflow logs own their model accounting; other calls accrue directly to Studio's ledger. */
export async function recordModelUsage(
  scope: ModelUsageScope,
  usage: NativeUsage,
  cost: NativeCost
): Promise<NativeCost> {
  if (scope.funding === 'byok') return { ...cost, accountCost: null }
  const copilot = ['copilot', 'title', 'wand'].includes(scope.purpose)
  if (!(await isBillingEnabledForRuntime())) return cost
  if (!copilot && scope.workflowId && scope.workspaceId && scope.executionId) {
    const [execution] = await db
      .select({ id: workflowExecutionLogs.id })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workflowId, scope.workflowId),
          eq(workflowExecutionLogs.workspaceId, scope.workspaceId),
          eq(workflowExecutionLogs.executionId, scope.executionId),
          isNull(workflowExecutionLogs.endedAt),
          sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${scope.actorUserId}`
        )
      )
      .limit(1)
    if (execution) return cost
  }
  if (cost.total !== undefined && (!Number.isFinite(cost.total) || cost.total < 0))
    throw new Error(`Model cost is unavailable for ${scope.model}`)
  const usdCost =
    ['reported', 'estimated'].includes(cost.status) &&
    (cost.currency === undefined || cost.currency === 'USD')
      ? cost.total
      : undefined
  if (usdCost === undefined && !copilot)
    throw new Error(`Model cost is unavailable for ${scope.model}`)
  const tokens =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined)
  if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 0))
    throw new Error('Model token usage must be a nonnegative safe integer')
  const billingContext = await resolveModelBillingContext(scope)
  const multiplier = copilot
    ? getTierCopilotCostMultiplier(billingContext.tier)
    : getTierWorkflowModelCostMultiplier(billingContext.tier)
  // Unknown model costs remain unknown; a zero ledger delta records only the usage counters.
  const chargedCost = usdCost === undefined ? 0 : usdCost * multiplier
  if (!Number.isFinite(chargedCost) || chargedCost < 0)
    throw new Error('Model charge must be finite and nonnegative')
  const accrued = await accrueUserUsageCost({
    userId: scope.actorUserId,
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    billingContext,
    cost: chargedCost,
    reason: scope.purpose,
    skipThresholdBilling: usdCost === undefined,
    extraUpdates: {
      ...(tokens !== undefined ? { totalTokensUsed: sql`total_tokens_used + ${tokens}` } : {}),
      ...(copilot
        ? {
            ...(usdCost !== undefined
              ? {
                  totalCopilotCost: sql`total_copilot_cost + ${chargedCost}`,
                  currentPeriodCopilotCost: sql`current_period_copilot_cost + ${chargedCost}`,
                }
              : {}),
            totalCopilotCalls: sql`total_copilot_calls + 1`,
            ...(tokens !== undefined
              ? { totalCopilotTokens: sql`total_copilot_tokens + ${tokens}` }
              : {}),
          }
        : {}),
    },
  })
  if (!accrued) throw new Error('Model usage billing ledger is missing')
  if (usdCost === undefined) return cost
  const reportedCost = { ...cost, total: chargedCost }
  for (const field of ['input', 'output', 'availableTotal'] as const) {
    const amount = cost[field]
    if (amount !== undefined) reportedCost[field] = amount * multiplier
  }
  return reportedCost
}
