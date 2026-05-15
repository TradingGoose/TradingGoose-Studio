import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import {
  formatWorkflowExecutionSSE,
  isTerminalWorkflowExecutionEvent,
  type WorkflowExecutionEventEntry,
} from '@/lib/workflows/execution-events'

const logger = createLogger('WorkflowExecutionStream')
const POLL_INTERVAL_MS = 500
const MAX_POLL_DURATION_MS = 55 * 60 * 1000

type WorkflowExecutionStreamChunk = string | Uint8Array
type WorkflowExecutionEventFormatter = (
  entry: WorkflowExecutionEventEntry
) => WorkflowExecutionStreamChunk | WorkflowExecutionStreamChunk[] | null | undefined
type WorkflowExecutionEventState = NonNullable<
  Awaited<ReturnType<typeof readWorkflowExecutionEventState>>
>

type WorkflowExecutionEventStreamParams = {
  pendingExecutionId: string
  workflowId: string
  fromEventId?: number
  requestId?: string
  formatEvent?: WorkflowExecutionEventFormatter
  formatError?: (error: unknown) => WorkflowExecutionStreamChunk | WorkflowExecutionStreamChunk[]
}

type OpenWorkflowExecutionEventStreamResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; reason: 'notFound' }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function toChunks(
  value: ReturnType<WorkflowExecutionEventFormatter>
): WorkflowExecutionStreamChunk[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function createSeededWorkflowExecutionEventStream(
  params: WorkflowExecutionEventStreamParams & { initialState: WorkflowExecutionEventState }
) {
  const encoder = new TextEncoder()
  const formatEvent =
    params.formatEvent ??
    ((entry: WorkflowExecutionEventEntry) => formatWorkflowExecutionSSE(entry.event))
  let closed = false

  const encode = (chunk: WorkflowExecutionStreamChunk) =>
    typeof chunk === 'string' ? encoder.encode(chunk) : chunk

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = params.fromEventId ?? 0
      let nextState: WorkflowExecutionEventState | null = params.initialState
      const deadline = Date.now() + MAX_POLL_DURATION_MS

      const enqueue = (chunk: WorkflowExecutionStreamChunk) => {
        if (closed) return
        try {
          controller.enqueue(encode(chunk))
        } catch {
          closed = true
        }
      }

      const enqueueEvents = async () => {
        const state =
          nextState ??
          (await readWorkflowExecutionEventState({
            pendingExecutionId: params.pendingExecutionId,
            workflowId: params.workflowId,
            afterEventId: lastEventId,
          }))
        nextState = null

        if (!state) {
          throw new Error('Workflow execution stream was not found')
        }

        let sawTerminalEvent = false
        for (const entry of state.events) {
          if (closed) break
          for (const chunk of toChunks(formatEvent(entry))) {
            enqueue(chunk)
          }
          lastEventId = entry.eventId
          sawTerminalEvent ||= isTerminalWorkflowExecutionEvent(entry.event)
        }

        if (!sawTerminalEvent && (state.status === 'completed' || state.status === 'failed')) {
          throw new Error('Workflow execution ended without a terminal stream event')
        }

        return sawTerminalEvent
      }

      try {
        while (!closed && Date.now() < deadline) {
          if (await enqueueEvents()) {
            enqueue('data: [DONE]\n\n')
            if (!closed) controller.close()
            return
          }
          await sleep(POLL_INTERVAL_MS)
        }

        if (!closed) {
          throw new Error('Workflow execution stream ended before completion')
        }
      } catch (error) {
        logger.error('Workflow execution stream failed', {
          workflowId: params.workflowId,
          executionId: params.pendingExecutionId,
          requestId: params.requestId,
          error,
        })

        const formattedError = params.formatError?.(error)
        if (formattedError && !closed) {
          for (const chunk of toChunks(formattedError)) {
            enqueue(chunk)
          }
          if (!closed) controller.close()
          return
        }

        if (!closed) controller.error(error)
      }
    },
    cancel() {
      closed = true
    },
  })
}

export async function openWorkflowExecutionEventStream(
  params: WorkflowExecutionEventStreamParams
): Promise<OpenWorkflowExecutionEventStreamResult> {
  const initialState = await readWorkflowExecutionEventState({
    pendingExecutionId: params.pendingExecutionId,
    workflowId: params.workflowId,
    afterEventId: params.fromEventId ?? 0,
  })

  if (!initialState) {
    return { ok: false, reason: 'notFound' }
  }

  return {
    ok: true,
    stream: createSeededWorkflowExecutionEventStream({
      ...params,
      initialState,
    }),
  }
}
