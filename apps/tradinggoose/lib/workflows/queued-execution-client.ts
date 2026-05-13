import type { ExecutionResult } from '@/executor/types'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'

type QueuedWorkflowExecutionRequest = {
  workflowId: string
  executionId?: string
  input?: unknown
  triggerType: 'api' | 'manual' | 'chat'
  executionTarget: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  startBlockId?: string
  selectedOutputs?: string[]
  stream?: boolean
  signal?: AbortSignal
}

type QueueResponse = {
  success?: boolean
  taskId?: string
  executionId?: string
  error?: string
}

export type QueuedWorkflowExecutionCallbacks = {
  onEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readError(response: Response, defaultMessage: string) {
  const payload = await response.json().catch(() => null)
  if (isRecord(payload)) {
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
  }
  return defaultMessage
}

export async function queueWorkflowExecution(
  request: QueuedWorkflowExecutionRequest
): Promise<{ taskId: string; executionId?: string }> {
  const response = await fetch(`/api/workflows/${request.workflowId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: request.signal,
    body: JSON.stringify({
      executionId: request.executionId,
      input: request.input,
      triggerType: request.triggerType,
      executionTarget: request.executionTarget,
      workflowData: request.workflowData,
      workflowVariables: request.workflowVariables,
      startBlockId: request.startBlockId,
      selectedOutputs: request.selectedOutputs,
      stream: request.stream === true,
    }),
  })

  if (!response.ok) {
    throw new Error(
      await readError(response, `Failed to queue workflow execution: ${response.status}`)
    )
  }

  const payload = (await response.json().catch(() => null)) as QueueResponse | null
  if (!payload?.taskId) {
    throw new Error('Workflow queue response is missing taskId')
  }

  return {
    taskId: payload.taskId,
    executionId: payload.executionId,
  }
}

export async function cancelQueuedWorkflowExecution(taskId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${taskId}`, {
    method: 'DELETE',
    cache: 'no-store',
  })

  if (!response.ok && response.status !== 404) {
    throw new Error(
      await readError(response, `Failed to cancel workflow execution: ${response.status}`)
    )
  }
}

async function readQueuedWorkflowExecutionStream(params: {
  workflowId: string
  executionId: string
  signal?: AbortSignal
  callbacks?: QueuedWorkflowExecutionCallbacks
}): Promise<ExecutionResult> {
  const response = await fetch(
    `/api/workflows/${params.workflowId}/executions/${params.executionId}/stream?from=0`,
    {
      signal: params.signal,
      cache: 'no-store',
    }
  )

  if (!response.ok || !response.body) {
    throw new Error(
      await readError(response, `Failed to open workflow execution stream: ${response.status}`)
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminalResult: ExecutionResult | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop() ?? ''

      for (const message of messages) {
        if (!message.trim() || !message.startsWith('data: ')) continue

        const data = message.slice(6).trim()
        if (data === '[DONE]') break

        const event = JSON.parse(data) as WorkflowExecutionEvent
        await params.callbacks?.onEvent?.(event)

        if (event.type === 'execution:completed') {
          if (isExecutionResult(event.data.result)) {
            terminalResult = event.data.result
          }
        } else if (event.type === 'execution:error') {
          if (isExecutionResult(event.data.result)) {
            terminalResult = event.data.result
          } else {
            throw new Error(event.data.error || 'Workflow execution failed')
          }
        } else if (event.type === 'execution:cancelled') {
          if (isExecutionResult(event.data.result)) {
            terminalResult = event.data.result
          } else {
            terminalResult = {
              success: false,
              output: {},
              error: 'Workflow execution was cancelled',
              logs: [],
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!terminalResult) {
    throw new Error('Workflow execution stream ended without a final result')
  }

  return terminalResult
}

export async function runQueuedWorkflowExecution(
  request: QueuedWorkflowExecutionRequest,
  callbacks?: QueuedWorkflowExecutionCallbacks
): Promise<ExecutionResult> {
  const queued = await queueWorkflowExecution(request)
  const executionId = queued.executionId ?? request.executionId ?? queued.taskId
  const cancelQueuedExecution = () => {
    void cancelQueuedWorkflowExecution(queued.taskId).catch(() => {})
  }

  if (request.signal?.aborted) {
    cancelQueuedExecution()
  } else {
    request.signal?.addEventListener('abort', cancelQueuedExecution, { once: true })
  }

  try {
    return await readQueuedWorkflowExecutionStream({
      workflowId: request.workflowId,
      executionId,
      signal: request.signal,
      callbacks,
    })
  } finally {
    request.signal?.removeEventListener('abort', cancelQueuedExecution)
  }
}
