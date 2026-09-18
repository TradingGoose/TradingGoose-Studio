import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import type { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
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

export async function executeScheduleJob(payload: ScheduleExecutionPayload) {
  const executionId = payload.executionId
  const requestId = executionId.slice(0, 8)
  const now = new Date(payload.now)

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  let cron: Cron | undefined
  let failure: { error: unknown } | undefined
  const updateScheduleNextRun = async (
    fields: {
      failedCount?: number
      status?: 'active' | 'disabled'
      lastRanAt?: Date
      lastFailedAt?: Date
    } = {}
  ) => {
    const nextRunAt = cron?.nextRun()
    await db
      .update(workflowSchedule)
      .set({
        updatedAt: now,
        ...(cron ? { nextRunAt } : {}),
        ...fields,
        ...(cron && !nextRunAt ? { status: 'disabled' } : {}),
      })
      .where(eq(workflowSchedule.id, payload.scheduleId))
  }

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
      await updateScheduleNextRun()
      return
    }

    if (result.success) {
      logger.info(
        `[${requestId}] Workflow ${payload.workflowId} ${result.status ?? 'executed successfully'}`
      )

      await updateScheduleNextRun({ lastRanAt: now, failedCount: 0 })

      return
    }

    logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)
  } catch (error) {
    logger.error(`[${requestId}] Error executing scheduled workflow ${payload.workflowId}`, error)
    failure = { error }
  }

  const failedCount = (payload.failedCount ?? 0) + 1
  const shouldDisable = failedCount >= MAX_CONSECUTIVE_FAILURES
  if (shouldDisable) {
    logger.warn(
      `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
    )
  }
  await updateScheduleNextRun({
    failedCount,
    lastFailedAt: now,
    status: shouldDisable ? 'disabled' : 'active',
  })
  if (failure) throw failure.error
}
