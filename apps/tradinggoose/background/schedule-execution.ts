import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import type { Cron } from 'croner'
import { and, eq, lte } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { createScheduleCron } from '@/lib/schedules/utils'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
} from '@/lib/workflows/execution-runner'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  executionId: string
  blockId: string
  cronExpression: string
  failedCount?: number
  utcOffset: number
  now: string
}

export function isScheduleExecutionPayload(value: unknown): value is ScheduleExecutionPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.scheduleId === 'string' &&
    typeof candidate.workflowId === 'string' &&
    typeof candidate.blockId === 'string' &&
    typeof candidate.executionId === 'string' &&
    typeof candidate.cronExpression === 'string' &&
    typeof candidate.utcOffset === 'number' &&
    Number.isFinite(candidate.utcOffset) &&
    typeof candidate.now === 'string'
  )
}

export async function settleScheduleOccurrence(
  payload: ScheduleExecutionPayload,
  outcome: 'success' | 'failure' | 'usage_limited',
  cron: Cron | null = createScheduleCron(payload.cronExpression, payload.utcOffset)
) {
  const now = new Date(payload.now)
  const nextRunAt = cron?.nextRun()
  const failedCount = outcome === 'success' ? 0 : (payload.failedCount ?? 0) + 1
  const shouldDisable = failedCount >= MAX_CONSECUTIVE_FAILURES
  if (outcome === 'failure' && shouldDisable) {
    logger.warn(
      `[${payload.executionId.slice(0, 8)}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
    )
  }
  await db
    .update(workflowSchedule)
    .set({
      updatedAt: now,
      ...(cron ? { nextRunAt } : {}),
      ...(outcome !== 'usage_limited' ? { failedCount } : {}),
      ...(outcome === 'success' ? { lastRanAt: now } : {}),
      ...(outcome === 'failure'
        ? { lastFailedAt: now, status: shouldDisable ? 'disabled' : 'active' }
        : {}),
      ...(cron && !nextRunAt ? { status: 'disabled' } : {}),
    })
    .where(
      and(
        eq(workflowSchedule.id, payload.scheduleId),
        // A recovered checkpoint must not advance an already-settled or reconfigured occurrence.
        lte(workflowSchedule.nextRunAt, now)
      )
    )
}

export async function executeScheduleJob(payload: ScheduleExecutionPayload) {
  const executionId = payload.executionId
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  let cron: Cron | null = null
  let executionSucceeded = false
  let failure: { error: unknown } | undefined

  try {
    cron = createScheduleCron(payload.cronExpression, payload.utcOffset)
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
      return
    }

    if (!workflowRecord.workspaceId) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} is missing workspaceId`)
      return
    }

    const actorUserId = await getApiKeyOwnerUserId(workflowRecord.pinnedApiKeyId)

    if (!actorUserId) {
      logger.warn(
        `[${requestId}] Skipping schedule ${payload.scheduleId}: pinned API key required to attribute usage.`
      )
      return
    }

    const blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      workflowContext: workflowRecord,
      executionTarget: 'deployed',
    })
    if (!blueprint.workflowData.blocks[payload.blockId]) {
      logger.warn(
        `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Removing schedule.`
      )
      await db.delete(workflowSchedule).where(eq(workflowSchedule.id, payload.scheduleId))
      return
    }

    const { result, dispatchFailureReason } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId,
      requestId,
      executionId,
      triggerType: 'schedule',
      contextExtensions: { pendingExecutionId: executionId },
      workflowInput: {
        _context: {
          workflowId: payload.workflowId,
        },
      },
      triggerTarget: {
        kind: 'block',
        blockId: payload.blockId,
      },
    })

    if (dispatchFailureReason === 'usage_limit_exceeded') {
      await settleScheduleOccurrence(payload, 'usage_limited', cron)
      return
    }

    executionSucceeded = result.success
    if (executionSucceeded) {
      logger.info(
        `[${requestId}] Workflow ${payload.workflowId} ${result.status ?? 'executed successfully'}`
      )
    } else {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error executing scheduled workflow ${payload.workflowId}`, error)
    failure = { error }
    const execution = await readWorkflowExecutionEventState({
      pendingExecutionId: executionId,
      workflowId: payload.workflowId,
    })
    executionSucceeded = execution?.status === 'completed'
  }

  await settleScheduleOccurrence(payload, executionSucceeded ? 'success' : 'failure', cron)
  if (failure) throw failure.error
}
