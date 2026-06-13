import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import type { ExecutionResult } from '@/executor/types'
import type { QueuedWorkflowTriggerType } from '@/services/queue'

type QueuedWorkflowExecutionRequest = {
  workflowId: string
  executionId?: string
  input?: unknown
  triggerType: QueuedWorkflowTriggerType
  executionTarget: 'deployed' | 'live'
  workflowData?: WorkflowExecutionBlueprint['workflowData']
  workflowVariables?: Record<string, unknown>
  startBlockId?: string
  triggerSource?: string
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

type QueuedWorkflowExecutionHandle = {
  taskId: string
  executionId: string
  stream?: ReadableStream<Uint8Array>
}

type JobStatusResponse = {
  success?: boolean
  status?: string
  output?: unknown
  error?: string
}

export type QueuedWorkflowExecutionCallbacks = {
  onEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>
}

const JOB_STATUS_POLL_INTERVAL_MS = 1000

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

function abortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function waitForJobPollInterval(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError())

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timeout)
      reject(abortError())
    }
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, JOB_STATUS_POLL_INTERVAL_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function queueWorkflowExecution(
  request: QueuedWorkflowExecutionRequest
): Promise<QueuedWorkflowExecutionHandle> {
  const response = await fetch(`/api/workflows/${request.workflowId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      executionId: request.executionId,
      input: request.input,
      triggerType: request.triggerType,
      executionTarget: request.executionTarget,
      workflowData: request.workflowData,
      workflowVariables: request.workflowVariables,
      startBlockId: request.startBlockId,
      triggerSource: request.triggerSource,
      selectedOutputs: request.selectedOutputs,
      stream: request.stream === true,
    }),
  })

  if (!response.ok) {
    throw new Error(
      await readError(response, `Failed to queue workflow execution: ${response.status}`)
    )
  }

  if (request.stream === true) {
    const executionId = response.headers.get('X-Execution-Id') ?? request.executionId
    if (!executionId) {
      throw new Error('Workflow queue stream response is missing executionId')
    }
    if (!response.body) {
      throw new Error('Workflow queue stream response is missing body')
    }

    return {
      taskId: response.headers.get('X-Task-Id') ?? executionId,
      executionId,
      stream: response.body,
    }
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

async function readQueuedWorkflowExecutionJob(params: {
  taskId: string
  signal?: AbortSignal
}): Promise<ExecutionResult> {
  while (true) {
    const response = await fetch(`/api/jobs/${params.taskId}`, {
      signal: params.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(
        await readError(response, `Failed to read workflow execution job: ${response.status}`)
      )
    }

    const payload = (await response.json().catch(() => null)) as JobStatusResponse | null
    if (payload?.status === 'completed') {
      if (isExecutionResult(payload.output)) return payload.output
      throw new Error('Workflow execution job completed without a final result')
    }

    if (payload?.status === 'failed') {
      if (isExecutionResult(payload.output)) return payload.output
      return {
        success: false,
        output: {},
        error: payload.error || 'Workflow execution failed',
        logs: [],
      }
    }

    await waitForJobPollInterval(params.signal)
  }
}

async function readQueuedWorkflowExecutionStream(params: {
  stream: ReadableStream<Uint8Array>
  signal?: AbortSignal
  callbacks?: QueuedWorkflowExecutionCallbacks
}): Promise<ExecutionResult> {
  if (params.signal?.aborted) {
    throw abortError()
  }

  const reader = params.stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminalResult: ExecutionResult | null = null
  const cancelReader = () => {
    void reader.cancel(abortError()).catch(() => {})
  }

  try {
    params.signal?.addEventListener('abort', cancelReader, { once: true })
    while (true) {
      const { done, value } = await reader.read()
      if (params.signal?.aborted) {
        throw abortError()
      }
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
    params.signal?.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }

  if (params.signal?.aborted) {
    throw abortError()
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
  const cancelQueuedExecution = () => {
    void cancelQueuedWorkflowExecution(queued.taskId).catch(() => {})
  }

  if (request.signal?.aborted) {
    cancelQueuedExecution()
  } else {
    request.signal?.addEventListener('abort', cancelQueuedExecution, { once: true })
  }

  try {
    if (request.stream === true) {
      if (!queued.stream) {
        throw new Error('Workflow queue response is missing execution stream')
      }

      return await readQueuedWorkflowExecutionStream({
        stream: queued.stream,
        signal: request.signal,
        callbacks,
      })
    }

    return await readQueuedWorkflowExecutionJob({
      taskId: queued.taskId,
      signal: request.signal,
    })
  } finally {
    request.signal?.removeEventListener('abort', cancelQueuedExecution)
  }
}
