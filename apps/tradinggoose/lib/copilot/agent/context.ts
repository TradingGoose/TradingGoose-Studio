import { RequestContext } from '@mastra/core/request-context'
import type { ServerPending } from '@/lib/copilot/native/target'
import type { financialProcessors } from '@/lib/mastra/financial-processors'
import type { CopilotRun } from './state'

export type CopilotDecision =
  | { action: 'execute' }
  | { action: 'review.accept' | 'review.reject'; reviewToken: string }
  | { action: 'result'; result: unknown }

export interface CopilotExecution {
  run: CopilotRun
  finance: Awaited<ReturnType<typeof financialProcessors>>
  signal: AbortSignal
  pending?: ServerPending
  decision?: CopilotDecision
}

const executions = new Map<string, CopilotExecution>()

export function bindCopilotExecution(execution: CopilotExecution) {
  const id = crypto.randomUUID()
  executions.set(id, execution)
  const requestContext = new RequestContext()
  requestContext.set('copilot-execution', id)
  return {
    requestContext,
    close: () => {
      executions.delete(id)
    },
  }
}

export function getCopilotExecution(context: RequestContext): CopilotExecution | undefined {
  return executions.get(context.get('copilot-execution') as string)
}
