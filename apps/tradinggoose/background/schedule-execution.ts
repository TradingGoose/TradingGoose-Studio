import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import {
  ExecutionGateError,
  enforceServerExecutionRateLimit,
  getExecutionConcurrencyLimitMessage,
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
} from '@/lib/execution/execution-concurrency-limit'
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
import { RateLimitError } from '@/services/queue'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  executionId?: string
  blockId?: string
  cronExpression?: string
  lastRanAt?: string
  failedCount?: number
  timezone: string
  now: string
}

export function isScheduleExecutionPayload(
  value: unknown,
): value is ScheduleExecutionPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.scheduleId === 'string' &&
    typeof candidate.workflowId === 'string' &&
    typeof candidate.timezone === 'string' &&
    typeof candidate.now === 'string'
  )
}

async function calculateNextRunTime(
  schedule: { cronExpression?: string; lastRanAt?: string },
  blocks: Record<string, BlockState>,
  timezone: string,
): Promise<Date> {
  const scheduleBlock = Object.values(blocks).find(
    (block) => block.type === 'schedule',
  )
  if (!scheduleBlock) throw new Error('No schedule trigger block found')

  const scheduleType = getSubBlockValue(scheduleBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(scheduleBlock)
  const utcOffsetMinutes = await resolveTimezoneOffsetMinutes(timezone)

  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression, {
      utcOffset: utcOffsetMinutes,
    })
    const nextDate = cron.nextRun()
    if (!nextDate)
      throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  const lastRanAt = schedule.lastRanAt ? new Date(schedule.lastRanAt) : null
  return calculateNextTime(
    scheduleType,
    scheduleValues,
    lastRanAt,
    utcOffsetMinutes,
  )
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
      ...(typeof params.failedCount === 'number'
        ? { failedCount: params.failedCount }
        : {}),
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
    return calculateNextRunTime(
      params.payload,
      params.blocks,
      params.payload.timezone,
    )
  }

  if (params.workflowIsDeployed) {
    try {
      const deployedData = await loadDeployedWorkflowState(
        params.payload.workflowId,
      )
      return await calculateNextRunTime(
        params.payload,
        deployedData.blocks as Record<string, BlockState>,
        params.payload.timezone,
      )
    } catch {}
  }

  return new Date(params.now.getTime() + 24 * 60 * 60 * 1000)
}

export async function executeScheduleJob(payload: ScheduleExecutionPayload) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const now = new Date(payload.now)

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  const rescheduleSkippedExecution = async (
    blocks?: Record<string, BlockState>,
  ) => {
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
        calcErr,
      )
    }
  }

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
      return
    }

    const actorUserId = await getApiKeyOwnerUserId(
      workflowRecord.pinnedApiKeyId,
    )

    if (!actorUserId) {
      logger.warn(
        `[${requestId}] Skipping schedule ${payload.scheduleId}: pinned API key required to attribute usage.`,
      )
      return
    }

    try {
      await enforceServerExecutionRateLimit({
        actorUserId,
        workflowId: payload.workflowId,
        workspaceId: workflowRecord.workspaceId,
        isAsync: false,
        logger,
        requestId,
        source: 'scheduled execution',
        triggerType: 'schedule',
      })
    } catch (error) {
      if (error instanceof ExecutionGateError) {
        logger.warn(
          `[${requestId}] ${error.message} Skipping scheduled execution.`,
          {
            actorUserId,
            workflowId: payload.workflowId,
            workspaceId: workflowRecord.workspaceId,
          },
        )
        await rescheduleSkippedExecution()
        return
      }

      if (error instanceof RateLimitError) {
        logger.warn(`[${requestId}] ${error.message}`, {
          userId: workflowRecord.userId,
          workflowId: payload.workflowId,
        })

        await updateScheduleNextRun({
          scheduleId: payload.scheduleId,
          now,
          nextRunAt: new Date(now.getTime() + 5 * 60 * 1000),
        })

        return
      }

      throw error
    }

    const blueprint = await loadWorkflowExecutionBlueprint({
      workflowId: payload.workflowId,
      workflowContext: workflowRecord,
      executionTarget: 'deployed',
    })
    const scheduleBlocks = blueprint.workflowData.blocks as Record<
      string,
      BlockState
    >

    if (payload.blockId && !scheduleBlocks[payload.blockId]) {
      logger.warn(
        `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Skipping execution.`,
      )
      return
    }

    const { result } = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId,
      requestId,
      executionId,
      triggerType: 'schedule',
      workflowInput: {
        _context: {
          workflowId: payload.workflowId,
        },
      },
      start: {
        kind: 'block',
        blockId: payload.blockId || undefined,
      },
    })

    if (result.success) {
      logger.info(
        `[${requestId}] Workflow ${payload.workflowId} executed successfully`,
      )

      const nextRunAt = await calculateNextRunTime(
        payload,
        scheduleBlocks,
        payload.timezone,
      )

      await updateScheduleNextRun({
        scheduleId: payload.scheduleId,
        now,
        nextRunAt,
        lastRanAt: now,
        failedCount: 0,
      })

      return
    }

    logger.warn(
      `[${requestId}] Workflow ${payload.workflowId} execution failed`,
    )

    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
    const nextRunAt = await calculateNextRunTime(
      payload,
      scheduleBlocks,
      payload.timezone,
    )

    if (shouldDisable) {
      logger.warn(
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
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
    if (
      isExecutionConcurrencyLimitError(error) ||
      isExecutionConcurrencyBackendUnavailableError(error)
    ) {
      logger.warn(
        `[${requestId}] ${
          isExecutionConcurrencyLimitError(error)
            ? getExecutionConcurrencyLimitMessage(error)
            : error.message
        }`,
        {
          workflowId: payload.workflowId,
        },
      )
      throw error
    }

    if (error instanceof WorkflowUsageLimitError) {
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping scheduled execution.`,
        {
          workflowId: payload.workflowId,
          message: error.message,
        },
      )
      await rescheduleSkippedExecution()
      return
    }

    if (error.message?.includes('Service overloaded')) {
      logger.warn(
        `[${requestId}] Service overloaded while executing schedule`,
        {
          workflowId: payload.workflowId,
        },
      )
      throw error
    }

    logger.error(
      `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
      error,
    )

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
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
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
  }
}
