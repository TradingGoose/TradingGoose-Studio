import type { ExecutionResult } from '@/executor/types'

export type WorkflowLogTriggerType = 'manual' | 'chat' | 'api'

export async function startWorkflowExecutionLog(
  workflowId: string,
  executionId: string,
  triggerType: WorkflowLogTriggerType
): Promise<string> {
  const response = await fetch(`/api/workflows/${workflowId}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phase: 'start',
      executionId,
      triggerType,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to start execution log')
  }

  const data = (await response.json()) as { workflowLogId?: unknown }
  if (typeof data.workflowLogId !== 'string' || !data.workflowLogId) {
    throw new Error('Workflow log start response is missing workflowLogId')
  }

  return data.workflowLogId
}

export async function completeWorkflowExecutionLog(params: {
  workflowId: string
  executionId: string
  result: ExecutionResult
  workflowLogId: string
  triggerType: WorkflowLogTriggerType
}): Promise<void> {
  const response = await fetch(`/api/workflows/${params.workflowId}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phase: 'complete',
      executionId: params.executionId,
      workflowLogId: params.workflowLogId,
      triggerType: params.triggerType,
      result: params.result,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to persist logs')
  }
}
