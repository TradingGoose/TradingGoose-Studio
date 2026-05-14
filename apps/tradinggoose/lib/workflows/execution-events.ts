export type WorkflowExecutionEventType =
  | 'execution:started'
  | 'execution:completed'
  | 'execution:error'
  | 'execution:cancelled'
  | 'block:started'
  | 'block:completed'
  | 'block:error'
  | 'stream:chunk'
  | 'stream:done'

export type WorkflowExecutionBlockData = {
  blockId: string
  blockName?: string
  blockType?: string
  input?: unknown
  output?: unknown
  error?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  success?: boolean
  isCanceled?: boolean
  iterationCurrent?: number
  iterationTotal?: number
  iterationType?: 'loop' | 'parallel'
}

export type WorkflowExecutionEvent =
  | {
      type: 'execution:started'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        startTime: string
      }
    }
  | {
      type: 'execution:completed'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        result: unknown
      }
    }
  | {
      type: 'execution:error'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        error: string
        result?: unknown
      }
    }
  | {
      type: 'execution:cancelled'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        result?: unknown
      }
    }
  | {
      type: 'block:started'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: WorkflowExecutionBlockData
    }
  | {
      type: 'block:completed'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: WorkflowExecutionBlockData
    }
  | {
      type: 'block:error'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: WorkflowExecutionBlockData
    }
  | {
      type: 'stream:chunk'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        blockId: string
        chunk: string
      }
    }
  | {
      type: 'stream:done'
      executionId: string
      workflowId: string
      timestamp: string
      eventId?: number
      data: {
        blockId: string
      }
    }

export type WorkflowExecutionEventInput = WorkflowExecutionEvent extends infer Event
  ? Event extends WorkflowExecutionEvent
    ? Omit<Event, 'executionId' | 'workflowId' | 'timestamp' | 'eventId'> & {
        timestamp?: string
      }
    : never
  : never

export type WorkflowExecutionEventEntry = {
  eventId: number
  event: WorkflowExecutionEvent
}

export function isTerminalWorkflowExecutionEvent(event: WorkflowExecutionEvent) {
  return (
    event.type === 'execution:completed' ||
    event.type === 'execution:error' ||
    event.type === 'execution:cancelled'
  )
}

export function formatWorkflowExecutionSSE(event: WorkflowExecutionEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}
