import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import {
  enqueuePendingExecution,
  isPendingWorkflowExecutionCancellationRequested,
  PENDING_EXECUTION_CANCELLATION_ERROR,
} from '@/lib/execution/pending-execution'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'
import { validateWorkflowPauseInput } from '@/lib/workflows/human-in-the-loop/form'
import { workflowPauseLinks } from '@/lib/workflows/human-in-the-loop/links'
import {
  type StoredWorkflowCheckpoint,
  type WorkflowCheckpointLogData,
  type WorkflowCheckpointSnapshot,
  type WorkflowCheckpointView,
  type WorkflowPausePoint,
  workflowResumeJobId,
} from '@/lib/workflows/human-in-the-loop/types'

type ExecutionLog = typeof workflowExecutionLogs.$inferSelect
const dataOf = (row: ExecutionLog) => row.executionData as WorkflowCheckpointLogData
const isSubmitted = (point: WorkflowPausePoint) => point.input !== undefined

const executionLogQuery = (executionId: string, connection: Pick<typeof db, 'select'> = db) =>
  connection
    .select()
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

export class WorkflowCheckpointError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409
  ) {
    super(message)
    this.name = 'WorkflowCheckpointError'
  }
}

function projectCheckpoint(row: ExecutionLog): WorkflowCheckpointView {
  const data = dataOf(row)
  const checkpoint = data.checkpoint
  return {
    executionId: row.executionId,
    workflowId: row.workflowId!,
    revision: checkpoint?.revision ?? 0,
    status: row.endedAt
      ? row.level !== 'error'
        ? 'completed'
        : data.errorMessage === PENDING_EXECUTION_CANCELLATION_ERROR
          ? 'cancelled'
          : 'failed'
      : data.pause
        ? checkpoint?.activeJobId
          ? 'queued'
          : 'paused'
        : 'running',
    pausePoints: (checkpoint?.pausePoints ?? []).map(
      ({ notification: _notification, reviewerId: _reviewer, ...point }) => point
    ),
  }
}

export async function saveWorkflowCheckpoint(args: {
  executionId: string
  pendingExecutionId?: string
  workflowId: string
  workspaceId: string
  userId: string
  snapshot: WorkflowCheckpointSnapshot
  pausePoints: WorkflowPausePoint[]
}): Promise<{ revision: number; pausePoints: WorkflowPausePoint[] }> {
  if (
    !args.pausePoints.length ||
    new Set(args.pausePoints.map((point) => point.id)).size !== args.pausePoints.length
  ) {
    throw new WorkflowCheckpointError('Checkpoint requires uniquely identified pause points', 400)
  }
  const { encrypted } = await encryptSecret(JSON.stringify(args.snapshot))
  const pausePoints = args.pausePoints.map(({ notification: _notification, ...point }) => point)
  return db.transaction(async (tx) => {
    const [row] = await executionLogQuery(args.executionId, tx).for('update')
    if (!row || row.endedAt)
      throw new WorkflowCheckpointError('Execution is already terminal or its log is missing')
    const data = dataOf(row)
    if (
      row.id !== args.snapshot.workflowLogId ||
      row.workflowId !== args.workflowId ||
      row.workspaceId !== args.workspaceId ||
      data.environment?.userId !== args.userId
    ) {
      throw new WorkflowCheckpointError('Checkpoint execution scope does not match')
    }
    if (
      args.pendingExecutionId &&
      (await isPendingWorkflowExecutionCancellationRequested(args.pendingExecutionId, tx))
    )
      throw new WorkflowCheckpointError(PENDING_EXECUTION_CANCELLATION_ERROR)
    const previous = data.checkpoint
    if (previous && data.pause)
      return { revision: previous.revision, pausePoints: previous.pausePoints }
    if (previous && !previous.activeJobId)
      throw new WorkflowCheckpointError('Execution is being cancelled')
    const revision = (previous?.revision ?? 0) + 1
    const checkpoint: StoredWorkflowCheckpoint = {
      revision,
      encryptedSnapshot: encrypted,
      pausePoints,
      activeJobId: null,
    }
    await tx
      .update(workflowExecutionLogs)
      .set({
        executionData: {
          ...data,
          checkpoint,
          pause: { ...workflowPauseLinks(args.workflowId, args.executionId), revision },
        },
      })
      .where(eq(workflowExecutionLogs.id, row.id))
    return { revision, pausePoints }
  })
}

export async function claimWorkflowCheckpoint(args: {
  executionId: string
  revision: number
  jobId: string
}) {
  if (args.jobId !== workflowResumeJobId(args.executionId, args.revision)) return null
  return db.transaction(async (tx) => {
    const [row] = await executionLogQuery(args.executionId, tx).for('update')
    if (!row || row.endedAt || !row.workflowId) return null
    const data = dataOf(row)
    const checkpoint = data.checkpoint
    if (
      !checkpoint ||
      !data.pause ||
      checkpoint.revision !== args.revision ||
      checkpoint.activeJobId !== args.jobId
    )
      return null
    const access = await authorizeWorkflowScope(
      { success: true, userId: data.environment?.userId },
      row.workflowId,
      'write'
    )
    if (!access.ok || access.workspaceId !== row.workspaceId)
      throw new WorkflowCheckpointError(
        'The original execution user no longer has workflow access',
        403
      )
    if (!checkpoint.pausePoints.every(isSubmitted))
      throw new WorkflowCheckpointError('Checkpoint still awaits input')
    const { decrypted } = await decryptSecret(checkpoint.encryptedSnapshot)
    const snapshot = JSON.parse(decrypted) as WorkflowCheckpointSnapshot
    if (
      !snapshot?.executor ||
      snapshot.blueprint?.workflowId !== row.workflowId ||
      snapshot.workflowLogId !== row.id
    )
      throw new WorkflowCheckpointError('Invalid stored checkpoint', 500)
    const { pause: _pause, ...runningData } = data
    await tx
      .update(workflowExecutionLogs)
      .set({ executionData: runningData })
      .where(eq(workflowExecutionLogs.id, row.id))
    return {
      snapshot,
      pausePoints: checkpoint.pausePoints,
      executionId: row.executionId,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      userId: access.userId,
      revision: checkpoint.revision,
    }
  })
}

/** Internal recovery data only; never return this from a review endpoint. */
export async function readWorkflowCheckpointSnapshot(executionId: string) {
  const [row] = await executionLogQuery(executionId)
  const checkpoint = row && !row.endedAt && dataOf(row).checkpoint
  if (!checkpoint) return null
  const { decrypted } = await decryptSecret(checkpoint.encryptedSnapshot)
  return JSON.parse(decrypted) as WorkflowCheckpointSnapshot
}

export async function readWorkflowCheckpointChildren(executionId: string) {
  const rows = await db
    .select()
    .from(workflowExecutionLogs)
    .where(
      and(
        isNull(workflowExecutionLogs.endedAt),
        sql`${workflowExecutionLogs.executionData}->'trigger'->'data'->'queuedExecution' @> ${JSON.stringify({ source: 'workflow_block', parentExecutionId: executionId })}::jsonb`
      )
    )
  return rows.flatMap((row) => {
    const userId = dataOf(row).environment?.userId
    return userId ? [{ id: row.executionId, userId }] : []
  })
}

export async function readWorkflowCheckpoint(
  executionId: string,
  workflowId: string,
  workspaceId?: string
) {
  const [row] = await executionLogQuery(executionId)
  return row &&
    row.workflowId === workflowId &&
    (!workspaceId || row.workspaceId === workspaceId) &&
    (row.endedAt || dataOf(row).checkpoint)
    ? projectCheckpoint(row)
    : null
}

async function submitCheckpoint(args: {
  executionId: string
  workflowId: string
  revision: number
  pausePointId: string
  input: unknown
  reviewerId?: string
  childExecutionId?: string
  workspaceId?: string
}): Promise<WorkflowCheckpointView> {
  const [identity] = await executionLogQuery(args.executionId)
  const userId = identity && dataOf(identity).environment?.userId
  if (
    !identity ||
    !userId ||
    identity.workflowId !== args.workflowId ||
    (args.workspaceId && args.workspaceId !== identity.workspaceId)
  )
    throw new WorkflowCheckpointError('Paused execution not found', 404)
  const jobId = workflowResumeJobId(args.executionId, args.revision)
  await enqueuePendingExecution({
    pendingExecutionId: jobId,
    executionType: 'workflow',
    workflowId: args.workflowId,
    workspaceId: identity.workspaceId,
    userId,
    source: 'human_in_the_loop',
    continuation: true,
    payload: {
      workflowId: args.workflowId,
      userId,
      workspaceId: identity.workspaceId,
      resumeExecutionId: identity.executionId,
      checkpointRevision: args.revision,
    },
    beforeEnqueue: async (tx) => {
      const [row] = await executionLogQuery(args.executionId, tx).for('update')
      if (row?.endedAt) return false
      const data = row && dataOf(row)
      const checkpoint = data?.checkpoint
      if ((!checkpoint || checkpoint.revision !== args.revision) && args.childExecutionId)
        return false
      if (!checkpoint || checkpoint.revision !== args.revision)
        throw new WorkflowCheckpointError(
          'This review belongs to an older checkpoint; reload the page'
        )
      if (
        !row ||
        row.id !== identity.id ||
        row.workflowId !== args.workflowId ||
        row.workspaceId !== identity.workspaceId ||
        data?.environment?.userId !== userId
      )
        throw new WorkflowCheckpointError('Checkpoint scope changed')
      const point = checkpoint.pausePoints.find((item) => item.id === args.pausePointId)
      if (!point && args.childExecutionId) return false
      if (!point) throw new WorkflowCheckpointError('Pause point not found', 404)
      if (
        args.childExecutionId
          ? point.kind !== 'child' || point.childExecutionId !== args.childExecutionId
          : point.kind !== 'human' || !args.reviewerId
      ) {
        throw new WorkflowCheckpointError(
          'This pause point cannot be submitted by this caller',
          403
        )
      }
      if (isSubmitted(point)) return Boolean(data?.pause && checkpoint.activeJobId)
      if (!data?.pause && args.childExecutionId) return false
      if (!data?.pause || checkpoint.activeJobId)
        throw new WorkflowCheckpointError('Execution is no longer awaiting input')
      let input: Record<string, unknown>
      if (args.childExecutionId) {
        if (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))
          throw new WorkflowCheckpointError('Invalid child result', 400)
        input = args.input as Record<string, unknown>
      } else {
        try {
          input = validateWorkflowPauseInput(point.inputFormat, args.input)
        } catch (error) {
          throw new WorkflowCheckpointError(
            error instanceof Error ? error.message : 'Invalid resume input',
            400
          )
        }
      }
      const pausePoints = checkpoint.pausePoints.map((item) =>
        item.id === point.id
          ? { ...item, input, ...(args.reviewerId ? { reviewerId: args.reviewerId } : {}) }
          : item
      )
      const ready = pausePoints.every(isSubmitted)
      await tx
        .update(workflowExecutionLogs)
        .set({
          executionData: {
            ...data,
            checkpoint: { ...checkpoint, pausePoints, activeJobId: ready ? jobId : null },
          },
        })
        .where(eq(workflowExecutionLogs.id, row.id))
      return ready
    },
  })
  const result = await readWorkflowCheckpoint(
    args.executionId,
    args.workflowId,
    identity.workspaceId
  )
  if (!result) throw new WorkflowCheckpointError('Paused execution not found', 404)
  return result
}

export function submitWorkflowCheckpoint(args: {
  executionId: string
  workflowId: string
  revision: number
  pausePointId: string
  input: unknown
  reviewerId: string
  workspaceId?: string
}) {
  return submitCheckpoint(args)
}

export async function completeWorkflowCheckpointChild(args: {
  childExecutionId: string
  input: Record<string, unknown>
}) {
  const rows = await db
    .select()
    .from(workflowExecutionLogs)
    .where(
      and(
        isNull(workflowExecutionLogs.endedAt),
        sql`${workflowExecutionLogs.executionData}->'checkpoint'->'pausePoints' @> ${JSON.stringify([{ childExecutionId: args.childExecutionId }])}::jsonb`
      )
    )
  for (const row of rows) {
    if (!row.workflowId) continue
    for (const point of dataOf(row).checkpoint?.pausePoints ?? []) {
      if (point.kind !== 'child' || point.childExecutionId !== args.childExecutionId) continue
      try {
        await submitCheckpoint({
          executionId: row.executionId,
          workflowId: row.workflowId,
          revision: dataOf(row).checkpoint!.revision,
          pausePointId: point.id,
          childExecutionId: args.childExecutionId,
          input: args.input,
        })
      } catch (error) {
        if (!(error instanceof WorkflowCheckpointError && error.statusCode === 404)) throw error
      }
    }
  }
}

/** Repair child completion that raced the parent's checkpoint commit. Safe to retry. */
export async function reconcileWorkflowCheckpointChildren(executionId: string) {
  const [row] = await executionLogQuery(executionId)
  if (!row || row.endedAt || !dataOf(row).pause) return
  for (const point of dataOf(row).checkpoint?.pausePoints ?? []) {
    if (point.kind !== 'child' || !point.childExecutionId || !point.childWorkflowId) continue
    const child = await readWorkflowExecutionEventState({
      pendingExecutionId: point.childExecutionId,
      workflowId: point.childWorkflowId,
    })
    if (child?.status === 'completed' || child?.status === 'failed') {
      await completeWorkflowCheckpointChild({
        childExecutionId: point.childExecutionId,
        input: { ...child.result },
      })
    }
  }
}

/** A newer checkpoint proves this queue owner already finished its execution segment. */
export async function recoverWorkflowCheckpointSegment(args: {
  executionId: string
  userId: string
  workflowId: string | null
  checkpointRevision: number
}) {
  const [row] = await executionLogQuery(args.executionId)
  if (!row || row.endedAt) return false
  const data = dataOf(row)
  if (
    data.environment?.userId !== args.userId ||
    (args.workflowId && row.workflowId !== args.workflowId) ||
    !data.checkpoint ||
    data.checkpoint.revision <= args.checkpointRevision
  )
    return false
  await reconcileWorkflowCheckpointChildren(args.executionId)
  return true
}
