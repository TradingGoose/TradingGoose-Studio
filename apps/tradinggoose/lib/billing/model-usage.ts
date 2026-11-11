import { sql } from 'drizzle-orm'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { accrueUserUsageCost } from '@/lib/billing/usage-accrual'
import type { NativeUsage } from '@/lib/mastra/usage'

export interface ModelUsageScope {
  actorUserId: string
  workspaceId?: string | null
  workflowId?: string | null
  runId: string
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

/** Workflow logs account for workflow model tokens. Standalone calls use the same Studio ledger. */
export async function recordModelUsage(scope: ModelUsageScope, usage: NativeUsage) {
  const copilot = ['copilot', 'title', 'wand'].includes(scope.purpose)
  if (scope.workflowId && !copilot) return
  const tokens =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined)
  if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 0))
    throw new Error('Model token usage must be a nonnegative safe integer')
  await accrueUserUsageCost({
    userId: scope.actorUserId,
    workspaceId: scope.workspaceId,
    // Mastra exposes tokens here, not a verified USD price. Never estimate a charge.
    cost: 0,
    extraUpdates: {
      ...(tokens !== undefined ? { totalTokensUsed: sql`total_tokens_used + ${tokens}` } : {}),
      ...(copilot
        ? {
            totalCopilotCalls: sql`total_copilot_calls + 1`,
            ...(tokens !== undefined
              ? { totalCopilotTokens: sql`total_copilot_tokens + ${tokens}` }
              : {}),
          }
        : {}),
    },
  })
}
