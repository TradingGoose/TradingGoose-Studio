import type { ModelRouterLanguageModel } from '@mastra/core/llm'
import { RequestContext } from '@mastra/core/request-context'
import type { JsonObject, Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import type { ToolId } from '@/lib/copilot/registry'
import { resolveCopilotToolContext } from '@/lib/copilot/tool-context'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { getNativeWorkflowsStore } from '@/lib/mastra/runtime'
import type { CopilotRun } from './ownership'
import type { CopilotWorkerToolResult } from './worker-contract'

export type CopilotDecision =
  | { action: 'review.accept' | 'review.reject' }
  | { action: 'result'; result: unknown }

export interface CopilotExecution {
  run: CopilotRun
  model: ModelRouterLanguageModel
  signal: AbortSignal
  assertOwnership: () => Promise<void>
  executeTool: (
    name: ToolId,
    args: JsonObject,
    toolCallId: string
  ) => Promise<CopilotWorkerToolResult>
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
