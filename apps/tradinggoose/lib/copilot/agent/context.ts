import { RequestContext } from '@mastra/core/request-context'
import { z } from 'zod'
import type { ServerPending } from '@/lib/copilot/native/target'
import type { usageProcessors } from '@/lib/mastra/usage-processors'
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
  usage: Awaited<ReturnType<typeof usageProcessors>>
  signal: AbortSignal
  pending?: ServerPending
  decision?: CopilotDecision
}

/** Runtime-only execution values are omitted by RequestContext's JSON serializer. */
export function createCopilotRequestContext(execution: CopilotExecution) {
  const context = new RequestContext<{ 'copilot-execution': () => CopilotExecution }>()
  context.set('copilot-execution', () => execution)
  return context
}

export function getCopilotExecution(context: RequestContext): CopilotExecution | undefined {
  return (context.get('copilot-execution') as (() => CopilotExecution) | undefined)?.()
}
