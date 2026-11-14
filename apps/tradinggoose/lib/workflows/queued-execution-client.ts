import type { CopilotToolTarget } from '@/lib/copilot/native/contract'
import { readSseData, waitToReconnect } from '@/lib/events/stream'
import {
  isTerminalWorkflowExecutionEvent,
  type WorkflowExecutionEvent,
} from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import type { ExecutionResult } from '@/executor/types'
import type { QueuedWorkflowTriggerType } from '@/services/queue'

type QueuedWorkflowExecutionRequest = {
  workflowId: string
  native?: CopilotToolTarget
  executionId?: string
  input?: unknown
  triggerType: QueuedWorkflowTriggerType
  executionTarget: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  triggerBlockId?: string
  selectedOutputs?: string[]
  signal?: AbortSignal
}

type QueueResponse = {
  taskId?: string
  executionId?: string
}

export type QueuedWorkflowExecutionHandle = {
  taskId: string
  executionId: string
}

export type QueuedWorkflowExecutionCallbacks = {
  onEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>
}

async function readError(response: Response, defaultMessage: string) {
  const payload = await response.json().catch(() => null)
  return typeof payload?.error === 'string' ? payload.error : defaultMessage
}

export async function queueWorkflowExecution(
  request: QueuedWorkflowExecutionRequest
): Promise<QueuedWorkflowExecutionHandle> {
  // Admission must return its task ID before cancellation can DELETE the job.
  const response = await fetch(`/api/workflows/${request.workflowId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      executionId: request.executionId,
      ...(request.native ? { native: request.native } : {}),
      input: request.input,
      triggerType: request.triggerType,
      executionTarget: request.executionTarget,
      workflowData: request.workflowData,
      workflowVariables: request.workflowVariables,
      triggerBlockId: request.triggerBlockId,
      selectedOutputs: request.selectedOutputs,
      stream: true,
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
  if (!payload.executionId) {
    throw new Error('Workflow queue response is missing executionId')
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

/** Observe the admitted execution; reconnecting never submits another workflow. */
export async function observeQueuedWorkflowExecution(
  handle: QueuedWorkflowExecutionHandle,
  { signal, callbacks }: { signal?: AbortSignal; callbacks?: QueuedWorkflowExecutionCallbacks } = {}
): Promise<ExecutionResult> {
  let lastEventId = 0
  while (true) {
    signal?.throwIfAborted()
    let response: Response
    try {
      response = await fetch(`/api/jobs/${handle.taskId}`, {
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(lastEventId) },
        signal,
        cache: 'no-store',
      })
    } catch {
      await waitToReconnect(signal)
      continue
    }
    if (!response.ok) {
      if (
        (response.status >= 500 && response.status !== 501) ||
        [408, 429].includes(response.status)
      ) {
        await waitToReconnect(signal)
        continue
      }
      throw new Error(
        await readError(response, `Workflow execution is unavailable: ${response.status}`)
      )
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
      throw new Error('Workflow execution response is not an event stream')
    const events = readSseData(response.body, { signal })
    try {
      while (true) {
        const next = await events.next().catch(() => null)
        signal?.throwIfAborted()
        if (!next || next.done) break
        const event = JSON.parse(next.value) as WorkflowExecutionEvent
        if (event.executionId !== handle.executionId)
          throw new Error('Workflow execution stream identity differs')
        if (event.eventId !== undefined && event.eventId <= lastEventId) continue
        await callbacks?.onEvent?.(event)
        if (event.eventId !== undefined) lastEventId = event.eventId
        if (isTerminalWorkflowExecutionEvent(event)) {
          if (!isExecutionResult(event.data.result))
            throw new Error('Workflow execution completed without a final result')
          return event.data.result
        }
      }
    } finally {
      await events.return()
    }
    await waitToReconnect(signal)
  }
}

export async function runQueuedWorkflowExecution(
  request: QueuedWorkflowExecutionRequest,
  callbacks?: QueuedWorkflowExecutionCallbacks
): Promise<ExecutionResult> {
  const queued = await queueWorkflowExecution(request)
  const cancelQueuedExecution = () => {
    void cancelQueuedWorkflowExecution(queued.taskId).catch(() => {})
  }
  if (request.signal?.aborted) cancelQueuedExecution()
  else request.signal?.addEventListener('abort', cancelQueuedExecution, { once: true })
  try {
    return await observeQueuedWorkflowExecution(queued, {
      signal: request.signal,
      callbacks,
    })
  } finally {
    request.signal?.removeEventListener('abort', cancelQueuedExecution)
  }
}
