import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
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
import type { InferenceFacts } from '@/lib/mastra/result'
import { type NativeCost, type NativeUsage, resultAccounting } from '@/lib/mastra/usage'

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

/** The existing execution log owns native attempts independently of an HTTP response. */
async function writeWorkflowModelUsage(
  scope: ModelUsageScope,
  attemptId: string,
  completed?: { usage: NativeUsage; cost: NativeCost }
): Promise<{ cost: NativeCost; needsSettlement: boolean } | undefined> {
  if (
    ['copilot', 'title', 'wand'].includes(scope.purpose) ||
    !scope.workflowId ||
    !scope.workspaceId ||
    !scope.executionId
  )
    return
  const observation = await db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workflowId, scope.workflowId!),
          eq(workflowExecutionLogs.workspaceId, scope.workspaceId!),
          eq(workflowExecutionLogs.executionId, scope.executionId!),
          sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${scope.actorUserId}`
        )
      )
      .limit(1)
      .for('update')
    if (!execution) return
    const data = (execution.executionData ?? {}) as Record<string, any>
    const billing = data.billing ?? {}
    const nativeUsage: Record<string, InferenceFacts> = billing.nativeUsage ?? {}
    const previous = Object.hasOwn(nativeUsage, attemptId) ? nativeUsage[attemptId] : undefined
    // Completion can upgrade an owned attempt after cancellation, but cannot admit new work then.
    if (!previous && (completed || execution.endedAt)) return
    if (
      previous &&
      (previous.model !== scope.model ||
        (previous.cost?.accountCost === null) !== (scope.funding === 'byok'))
    )
      throw new Error('Native workflow usage identity changed')
    if (previous && Object.hasOwn(previous, 'tokens'))
      return { cost: previous.cost!, needsSettlement: Boolean(execution.endedAt || data.pause) }
    const cost: NativeCost = {
      ...(completed?.cost ?? { status: 'unavailable' }),
      ...(scope.funding === 'byok' ? { accountCost: null } : {}),
    }
    const facts: InferenceFacts = {
      model: scope.model,
      cost,
      ...(completed ? { tokens: resultAccounting(completed.usage).tokens } : {}),
      generatedFields: completed ? ['model', 'tokens', 'cost'] : ['model', 'cost'],
    }
    await tx
      .update(workflowExecutionLogs)
      .set({
        executionData: {
          ...data,
          billing: { ...billing, nativeUsage: { ...nativeUsage, [attemptId]: facts } },
        },
      })
      .where(eq(workflowExecutionLogs.id, execution.id))
    return { cost, needsSettlement: Boolean(execution.endedAt || data.pause) }
  })
  // Commit observations before billing: a ledger outage must not erase completed usage.
  if (observation?.needsSettlement) {
    const { executionLogger } = await import('@/lib/logs/execution/logger')
    await executionLogger.settleWorkflowExecutionUsage(scope.executionId)
  }
  return observation
}

/** Admit only new attempts owned by an active, authenticated workflow execution. */
export async function beginWorkflowModelUsage(scope: ModelUsageScope, attemptId: string) {
  return Boolean(await writeWorkflowModelUsage(scope, attemptId))
}

/** Owned workflow observations settle through their log; other calls accrue directly. */
export async function recordModelUsage(
  scope: ModelUsageScope,
  usage: NativeUsage,
  cost: NativeCost,
  attemptId = scope.runId
): Promise<NativeCost> {
  const observation = await writeWorkflowModelUsage(scope, attemptId, { usage, cost })
  if (observation) return observation.cost
  if (scope.funding === 'byok') return { ...cost, accountCost: null }
  const copilot = ['copilot', 'title', 'wand'].includes(scope.purpose)
  if (!(await isBillingEnabledForRuntime())) return cost
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
