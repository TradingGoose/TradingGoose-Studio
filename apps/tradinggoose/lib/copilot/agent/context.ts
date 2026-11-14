import { RequestContext } from '@mastra/core/request-context'
import { z } from 'zod'
import type { Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import type { ServerPending } from '@/lib/copilot/native/target'
import { resolveCopilotToolContext } from '@/lib/copilot/tool-context'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import type { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { getNativeWorkflowsStore } from '@/lib/mastra/runtime'
import type { CopilotRun } from './state'

export const CopilotSuspendSchema = z.object({
  originalArgs: z.record(z.string(), z.json()),
  preview: z.record(z.string(), z.json()).optional(),
  reviewBaseStateHash: z.string().min(1).optional(),
})

export type CopilotDecision =
  | { action: 'execute' }
  | { action: 'review.accept' | 'review.reject' }
  | { action: 'result'; result: unknown }

export interface CopilotExecution {
  run: CopilotRun
  model: Awaited<ReturnType<typeof createConfiguredLanguageModel>>
  signal: AbortSignal
  assertOwnership: () => Promise<void>
  pending?: ServerPending
  decision?: CopilotDecision
  pendingTools: Set<Promise<void>>
}

export function resolveCopilotRunToolContext(
  run: CopilotRun,
  name: string,
  args: Record<string, unknown>
) {
  return resolveCopilotToolContext(
    name,
    args,
    run.toolContext ?? (run.scope.workspaceId ? { workspaceId: run.scope.workspaceId } : undefined),
    run.toolContexts
  )
}

/** Runtime-only execution values are omitted by RequestContext's JSON serializer. */
export function createCopilotRequestContext(execution: Omit<CopilotExecution, 'pendingTools'>) {
  const context = new RequestContext()
  const live: CopilotExecution = { ...execution, pendingTools: new Set() }
  context.set('copilot-run', execution.run)
  context.set('copilot-execution', () => live)
  return context
}

/** Mastra owns suspended run configuration together with its pending tools. */
export async function readCopilotRun(
  scope: Scope,
  threadId: string,
  runId: string
): Promise<CopilotRun> {
  const stored = await (await getNativeWorkflowsStore()).getWorkflowRunById({ runId })
  const snapshot =
    typeof stored?.snapshot === 'string' ? JSON.parse(stored.snapshot) : stored?.snapshot
  const run = snapshot?.requestContext?.['copilot-run'] as CopilotRun | undefined
  if (
    !run ||
    stored?.resourceId !== nativeConversationIdentity(scope).resourceId ||
    run.runId !== runId ||
    run.threadId !== threadId ||
    stableStringifyJsonValue(run.scope) !== stableStringifyJsonValue(scope)
  )
    throw new NativeTargetError('Copilot run is unavailable in this conversation scope', 403)
  return run
}

export function getCopilotExecution(context: RequestContext): CopilotExecution | undefined {
  return (context.get('copilot-execution') as (() => CopilotExecution) | undefined)?.()
}
