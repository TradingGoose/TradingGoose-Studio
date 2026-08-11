import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
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
  WorkflowUsageLimitError,
} from '@/lib/workflows/execution-runner'
import { executeWorkflowJob, type WorkflowExecutionAttemptOptions } from './workflow-execution'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  executionId?: string
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

export async function executeScheduleJob(
  payload: ScheduleExecutionPayload,
  options: WorkflowExecutionAttemptOptions
) {
  const executionId = payload.executionId ?? uuidv4()
  const requestId = executionId.slice(0, 8)
  const now = new Date(payload.now)

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
    let scheduleBlocks: Record<string, BlockState> = {}
    const result = await executeWorkflowJob(
      {
        workflowId: payload.workflowId,
        userId: options.fallbackActorUserId,
        workspaceId: options.fallbackWorkspaceId,
        executionId,
        triggerType: 'schedule',
        triggerBlockId: payload.blockId,
        executionTarget: 'deployed',
      },
      options,
      async () => {
        try {
          options.timeBudget.signal.throwIfAborted()
          const [workflowRecord] = await db
            .select()
            .from(workflow)
            .where(eq(workflow.id, payload.workflowId))
            .limit(1)
          options.timeBudget.signal.throwIfAborted()

          if (!workflowRecord) {
            logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
            return { kind: 'ignore' as const }
          }
          if (!workflowRecord.workspaceId) {
            logger.warn(`[${requestId}] Workflow ${payload.workflowId} is missing workspaceId`)
            return { kind: 'ignore' as const }
          }

          const actorUserId = await getApiKeyOwnerUserId(workflowRecord.pinnedApiKeyId)
          options.timeBudget.signal.throwIfAborted()
          if (!actorUserId) {
            logger.warn(
              `[${requestId}] Skipping schedule ${payload.scheduleId}: pinned API key required to attribute usage.`
            )
            return { kind: 'ignore' as const }
          }

          const blueprint = await loadWorkflowExecutionBlueprint({
            workflowId: payload.workflowId,
            workflowContext: workflowRecord,
            executionTarget: 'deployed',
          })
          options.timeBudget.signal.throwIfAborted()
          scheduleBlocks = blueprint.workflowData.blocks as Record<string, BlockState>
          if (!scheduleBlocks[payload.blockId]) {
            logger.warn(
              `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Removing schedule.`
            )
            options.timeBudget.signal.throwIfAborted()
            await db.delete(workflowSchedule).where(eq(workflowSchedule.id, payload.scheduleId))
            return { kind: 'ignore' as const }
          }

          options.timeBudget.signal.throwIfAborted()
          return {
            kind: 'execute' as const,
            payload: {
              workflowId: payload.workflowId,
              userId: actorUserId,
              workspaceId: workflowRecord.workspaceId,
              executionId,
              triggerType: 'schedule' as const,
              input: { _context: { workflowId: payload.workflowId } },
              triggerBlockId: payload.blockId,
              executionTarget: 'deployed' as const,
            },
            blueprint,
          }
        } catch (error) {
          if (options.timeBudget.signal.aborted) return { kind: 'ignore' as const }
          throw error
        }
      }
    )
    if (!result) return

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
    if (error instanceof WorkflowUsageLimitError) {
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping scheduled execution.`,
        {
          workflowId: payload.workflowId,
          message: error.message,
        }
      )
      await rescheduleSkippedExecution()
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
  }
}
