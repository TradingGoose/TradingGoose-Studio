import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import {
  finalizeWorkflowExecution,
  type WorkflowExecutionLifecycle,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import { createWorkflowExecutionRuntime } from '@/lib/execution/workflow-execution-runtime'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/schedules/utils'
import { resolveTimezoneOffsetMinutes } from '@/lib/timezone/timezone-resolver'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
  WorkflowUsageLimitError,
} from '@/lib/workflows/execution-runner'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  executionId?: string
  drainRunId?: string
  workflowExecutionLifecycle?: WorkflowExecutionLifecycle
  blockId: string
  cronExpression?: string
  lastRanAt?: string
  failedCount?: number
  timezone: string
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
    typeof candidate.timezone === 'string' &&
    typeof candidate.now === 'string'
  )
}

async function calculateNextRunTime(
  schedule: { blockId: string; cronExpression?: string; lastRanAt?: string },
  blocks: Record<string, BlockState>,
  timezone: string
): Promise<Date> {
  const scheduleBlock = blocks[schedule.blockId]
  if (!scheduleBlock) throw new Error(`Schedule trigger block ${schedule.blockId} not found`)

  const scheduleType = getSubBlockValue(scheduleBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(scheduleBlock)
  const utcOffsetMinutes = await resolveTimezoneOffsetMinutes(timezone)

  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression, {
      utcOffset: utcOffsetMinutes,
    })
    const nextDate = cron.nextRun()
    if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  const lastRanAt = schedule.lastRanAt ? new Date(schedule.lastRanAt) : null
  return calculateNextTime(scheduleType, scheduleValues, lastRanAt, utcOffsetMinutes)
}

async function updateScheduleNextRun(params: {
  scheduleId: string
  now: Date
  nextRunAt: Date
  failedCount?: number
  status?: 'active' | 'disabled'
  lastRanAt?: Date
  lastFailedAt?: Date
}) {
  await db
    .update(workflowSchedule)
    .set({
      updatedAt: params.now,
      nextRunAt: params.nextRunAt,
      ...(params.lastRanAt ? { lastRanAt: params.lastRanAt } : {}),
      ...(typeof params.failedCount === 'number' ? { failedCount: params.failedCount } : {}),
      ...(params.lastFailedAt ? { lastFailedAt: params.lastFailedAt } : {}),
      ...(params.status ? { status: params.status } : {}),
    })
    .where(eq(workflowSchedule.id, params.scheduleId))
}

async function resolveFallbackNextRunAt(params: {
  payload: ScheduleExecutionPayload
  workflowIsDeployed: boolean | null | undefined
  blocks?: Record<string, BlockState>
  now: Date
}) {
  if (params.blocks) {
    return calculateNextRunTime(params.payload, params.blocks, params.payload.timezone)
  }

  if (params.workflowIsDeployed) {
    try {
      const deployedData = await loadDeployedWorkflowState(params.payload.workflowId)
      return await calculateNextRunTime(
        params.payload,
        deployedData.blocks as Record<string, BlockState>,
        params.payload.timezone
      )
    } catch {}
  }

  return new Date(params.now.getTime() + 24 * 60 * 60 * 1000)
}

export async function executeScheduleJob(payload: ScheduleExecutionPayload) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Schedule workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const lifecycle = payload.workflowExecutionLifecycle
  const deadlineRuntime = createWorkflowExecutionRuntime(lifecycle, (error) =>
    logger.error(`[${requestId}] Workflow deadline heartbeat failed`, error)
  )
  const now = new Date(payload.now)
  let runnerInvoked = false
  let runnerRejected = false
  const settlePreparationFailure = async (message: string) => {
    await deadlineRuntime.settleStartup(deadlineRuntime.signal?.aborted ? 'local_abort' : 'failed')
    await finalizeWorkflowExecution({
      rootExecutionId: lifecycle.policy.rootExecutionId,
      attemptId: lifecycle.attemptId,
      result: { success: false, output: {}, error: message },
    })
  }

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  const rescheduleSkippedExecution = async (blocks?: Record<string, BlockState>) => {
    try {
      const nextRunAt = await resolveFallbackNextRunAt({
        payload,
        workflowIsDeployed: true,
        blocks,
        now,
      })
      await updateScheduleNextRun({
        scheduleId: payload.scheduleId,
        now,
        nextRunAt,
      })
    } catch (calcErr) {
      logger.warn(
        `[${requestId}] Unable to calculate nextRunAt while skipping schedule ${payload.scheduleId}`,
        calcErr
      )
    }
  }

  try {
    await deadlineRuntime.start()
    deadlineRuntime.signal?.throwIfAborted()
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)
    deadlineRuntime.signal?.throwIfAborted()

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
      await settlePreparationFailure(`Workflow ${payload.workflowId} not found`)
      return
    }

    if (!workflowRecord.workspaceId) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} is missing workspaceId`)
      await settlePreparationFailure(`Workflow ${payload.workflowId} is missing workspaceId`)
      return
    }

    const actorUserId = await getApiKeyOwnerUserId(workflowRecord.pinnedApiKeyId)
    deadlineRuntime.signal?.throwIfAborted()

    if (!actorUserId) {
      logger.warn(
        `[${requestId}] Skipping schedule ${payload.scheduleId}: pinned API key required to attribute usage.`
      )
      await settlePreparationFailure('Pinned API key is required to attribute schedule usage')
      return
    }

    const blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      workflowContext: workflowRecord,
      executionTarget: 'deployed',
    })
    deadlineRuntime.signal?.throwIfAborted()
    const scheduleBlocks = blueprint.workflowData.blocks as Record<string, BlockState>

    if (!scheduleBlocks[payload.blockId]) {
      logger.warn(
        `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Removing schedule.`
      )
      deadlineRuntime.signal?.throwIfAborted()
      await db.delete(workflowSchedule).where(eq(workflowSchedule.id, payload.scheduleId))
      await settlePreparationFailure(`Schedule trigger block ${payload.blockId} was not found`)
      return
    }

    runnerInvoked = true
    deadlineRuntime.signal?.throwIfAborted()
    const { result } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId,
      requestId,
      executionId,
      lifecycle,
      deadlineRuntime,
      triggerType: 'schedule',
      workflowInput: {
        _context: {
          workflowId: payload.workflowId,
        },
      },
      triggerTarget: {
        kind: 'block',
        blockId: payload.blockId,
      },
    }).catch((error) => {
      runnerRejected = true
      throw error
    })
    deadlineRuntime.signal?.throwIfAborted()

    if (result.success) {
      logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

      const nextRunAt = await calculateNextRunTime(payload, scheduleBlocks, payload.timezone)

      await updateScheduleNextRun({
        scheduleId: payload.scheduleId,
        now,
        nextRunAt,
        lastRanAt: now,
        failedCount: 0,
      })

      return
    }

    logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
    const nextRunAt = await calculateNextRunTime(payload, scheduleBlocks, payload.timezone)

    if (shouldDisable) {
      logger.warn(
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }

    await updateScheduleNextRun({
      scheduleId: payload.scheduleId,
      now,
      nextRunAt,
      failedCount: newFailedCount,
      lastFailedAt: now,
      status: shouldDisable ? 'disabled' : 'active',
    })
  } catch (error: any) {
    if (deadlineRuntime.signal?.aborted) {
      if (!runnerInvoked)
        await settlePreparationFailure(error.message || 'Workflow deadline reached')
      throw error
    }
    if (runnerRejected) throw error
    if (error instanceof WorkflowUsageLimitError) {
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping scheduled execution.`,
        {
          workflowId: payload.workflowId,
          message: error.message,
        }
      )
      await rescheduleSkippedExecution()
      if (!runnerInvoked) await settlePreparationFailure(error.message)
      return
    }

    logger.error(`[${requestId}] Error executing scheduled workflow ${payload.workflowId}`, error)

    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    const nextRunAt = await resolveFallbackNextRunAt({
      payload,
      workflowIsDeployed: workflowRecord?.isDeployed,
      now,
    })

    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

    if (shouldDisable) {
      logger.warn(
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }

    await updateScheduleNextRun({
      scheduleId: payload.scheduleId,
      now,
      nextRunAt,
      failedCount: newFailedCount,
      lastFailedAt: now,
      status: shouldDisable ? 'disabled' : 'active',
    })
    if (!runnerInvoked) {
      await settlePreparationFailure(
        error instanceof Error ? error.message : 'Scheduled workflow preparation failed'
      )
    }
  } finally {
    deadlineRuntime.close()
  }
}
