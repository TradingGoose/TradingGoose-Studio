import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventEntry,
  WorkflowExecutionEventInput,
} from '@/lib/workflows/execution-events'

const EVENT_PAYLOAD_KEY = 'executionEvents'

type PendingPayload = Record<string, unknown> & {
  executionEvents?: WorkflowExecutionEventEntry[]
}

function asPayload(value: unknown): PendingPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PendingPayload)
    : {}
}

function readPayloadEvents(value: unknown): WorkflowExecutionEventEntry[] {
  const events = asPayload(value)[EVENT_PAYLOAD_KEY]
  if (!Array.isArray(events)) return []

  return events.filter(
    (entry): entry is WorkflowExecutionEventEntry =>
      entry &&
      typeof entry === 'object' &&
      typeof entry.eventId === 'number' &&
      entry.event &&
      typeof entry.event === 'object'
  )
}

export function appendWorkflowExecutionEventToPayload(params: {
  payload: unknown
  pendingExecutionId: string
  workflowId: string
  input: WorkflowExecutionEventInput
}): {
  payload: PendingPayload
  entry: WorkflowExecutionEventEntry
} {
  const payload = asPayload(params.payload)
  const events = readPayloadEvents(payload)
  const eventId = events.reduce((max, entry) => Math.max(max, entry.eventId), 0) + 1
  const event = {
    ...params.input,
    executionId: params.pendingExecutionId,
    workflowId: params.workflowId,
    timestamp: params.input.timestamp ?? new Date().toISOString(),
    eventId,
  } as WorkflowExecutionEvent
  const entry = { eventId, event }

  return {
    payload: {
      ...payload,
      [EVENT_PAYLOAD_KEY]: [...events, entry],
    },
    entry,
  }
}

export async function createWorkflowExecutionEventWriter(params: {
  pendingExecutionId: string
  workflowId: string
}) {
  const [row] = await db
    .select({
      payload: pendingExecution.payload,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId)
      )
    )
    .limit(1)

  if (!row) {
    throw new Error(`Pending workflow execution ${params.pendingExecutionId} was not found`)
  }

  let writeChain = Promise.resolve()

  const write = async (
    input: WorkflowExecutionEventInput
  ): Promise<WorkflowExecutionEventEntry> => {
    const task = writeChain.then(async () => {
      const [currentRow] = await db
        .select({ payload: pendingExecution.payload })
        .from(pendingExecution)
        .where(
          and(
            eq(pendingExecution.id, params.pendingExecutionId),
            eq(pendingExecution.workflowId, params.workflowId)
          )
        )
        .limit(1)

      if (!currentRow) {
        throw new Error(`Pending workflow execution ${params.pendingExecutionId} was not found`)
      }

      const { payload, entry } = appendWorkflowExecutionEventToPayload({
        payload: currentRow.payload,
        pendingExecutionId: params.pendingExecutionId,
        workflowId: params.workflowId,
        input,
      })

      await db
        .update(pendingExecution)
        .set({
          payload,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pendingExecution.id, params.pendingExecutionId),
            eq(pendingExecution.workflowId, params.workflowId)
          )
        )

      return entry
    })

    writeChain = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  return { write }
}

export async function readWorkflowExecutionEventState(params: {
  pendingExecutionId: string
  workflowId: string
  afterEventId?: number
}) {
  const [row] = await db
    .select({
      status: pendingExecution.status,
      payload: pendingExecution.payload,
      result: pendingExecution.result,
      errorMessage: pendingExecution.errorMessage,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId)
      )
    )
    .limit(1)

  if (!row) return null

  const afterEventId = params.afterEventId ?? 0
  return {
    status: row.status,
    result: row.result,
    errorMessage: row.errorMessage,
    events: readPayloadEvents(row.payload).filter((entry) => entry.eventId > afterEventId),
  }
}
