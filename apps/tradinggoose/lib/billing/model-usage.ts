import { sql } from 'drizzle-orm'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierCopilotCostMultiplier } from '@/lib/billing/tiers'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import {
  resolveWorkflowBillingContext,
  resolveWorkspaceBillingContext,
} from '@/lib/billing/workspace-billing'
import type { NativeCost, NativeUsage } from '@/lib/mastra/usage'

export interface ModelUsageScope {
  actorUserId: string
  workspaceId?: string | null
  workflowId?: string | null
  runId: string
  model: string
  purpose: string
  signal?: AbortSignal
}

export async function assertModelUsageAllowed(scope: ModelUsageScope) {
  scope.signal?.throwIfAborted()
  const status = await checkServerSideUsageLimits({
    userId: scope.actorUserId,
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
  })
  if (status.isExceeded)
    throw Object.assign(new Error(status.message ?? 'Usage allowance exhausted'), { status: 402 })
  scope.signal?.throwIfAborted()
}

/** Workflow logs own workflow model accounting; standalone calls use the same Studio ledger. */
export async function recordModelUsage(
  scope: ModelUsageScope,
  usage: NativeUsage,
  cost: NativeCost
) {
  const copilot = ['copilot', 'title', 'wand'].includes(scope.purpose)
  if (scope.workflowId && !copilot) return
  if (!(await isBillingEnabledForRuntime())) return
  if (
    !['reported', 'estimated'].includes(cost.status) ||
    cost.total === undefined ||
    !Number.isFinite(cost.total) ||
    cost.total < 0 ||
    (cost.currency !== undefined && cost.currency !== 'USD')
  )
    throw new Error(`Model cost is unavailable for ${scope.model}`)
  const tokens =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined)
  if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 0))
    throw new Error('Model token usage must be a nonnegative safe integer')
  const billingContext = scope.workflowId
    ? await resolveWorkflowBillingContext({
        workflowId: scope.workflowId,
        actorUserId: scope.actorUserId,
      })
    : await resolveWorkspaceBillingContext({
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
      })
  const chargedCost = cost.total * (copilot ? getTierCopilotCostMultiplier(billingContext.tier) : 1)
  if (!Number.isFinite(chargedCost) || chargedCost < 0)
    throw new Error('Model charge must be finite and nonnegative')
  await accrueUserUsageCost({
    userId: scope.actorUserId,
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    billingContext,
    cost: chargedCost,
    extraUpdates: {
      ...(tokens !== undefined ? { totalTokensUsed: sql`total_tokens_used + ${tokens}` } : {}),
      ...(copilot
        ? {
            totalCopilotCost: sql`total_copilot_cost + ${chargedCost}`,
            currentPeriodCopilotCost: sql`current_period_copilot_cost + ${chargedCost}`,
            totalCopilotCalls: sql`total_copilot_calls + 1`,
            ...(tokens !== undefined
              ? { totalCopilotTokens: sql`total_copilot_tokens + ${tokens}` }
              : {}),
          }
        : {}),
    },
  })
}
