import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import type { WorkflowExecutionLifecycle } from '@/lib/execution/workflow-execution-lifecycle-repository'
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
import { executeWorkflowJob } from './workflow-execution'

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
  const executionId = payload.executionId
  if (!executionId) throw new Error('Schedule workflow execution requires an executionId')
  const requestId = executionId.slice(0, 8)
  if (!payload.workflowExecutionLifecycle) {
    throw new Error(`Schedule workflow execution ${executionId} is missing its claimed lifecycle`)
  }
  const now = new Date(payload.now)
  let scheduleBlocks: Record<string, BlockState> | undefined

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

  return executeWorkflowJob({
    workflowId: payload.workflowId,
    userId: '',
    executionId,
    drainRunId: payload.drainRunId,
    workflowExecutionLifecycle: payload.workflowExecutionLifecycle,
    triggerType: 'schedule',
    triggerBlockId: payload.blockId,
    input: { _context: { workflowId: payload.workflowId } },
    adapter: {
      prepare: async ({ signal }) => {
        signal?.throwIfAborted()
        const [workflowRecord] = await db
          .select()
          .from(workflow)
          .where(eq(workflow.id, payload.workflowId))
          .limit(1)
        signal?.throwIfAborted()
        if (!workflowRecord) throw new Error(`Workflow ${payload.workflowId} not found`)
        if (!workflowRecord.workspaceId) {
          throw new Error(`Workflow ${payload.workflowId} is missing workspaceId`)
        }
        const actorUserId = await getApiKeyOwnerUserId(workflowRecord.pinnedApiKeyId)
        signal?.throwIfAborted()
        if (!actorUserId) {
          throw new Error('Pinned API key is required to attribute schedule usage')
        }
        const blueprint = await loadWorkflowExecutionBlueprint({
          workflowId: payload.workflowId,
          workflowContext: workflowRecord,
          executionTarget: 'deployed',
        })
        signal?.throwIfAborted()
        scheduleBlocks = blueprint.workflowData.blocks as Record<string, BlockState>
        if (!scheduleBlocks[payload.blockId]) {
          await db.delete(workflowSchedule).where(eq(workflowSchedule.id, payload.scheduleId))
          throw new Error(`Schedule trigger block ${payload.blockId} was not found`)
        }
        return { userId: actorUserId, workspaceId: workflowRecord.workspaceId }
      },
      complete: async ({ result }) => {
        if (!scheduleBlocks) throw new Error('Schedule execution preparation was not completed')
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
        const newFailedCount = (payload.failedCount || 0) + 1
        const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
        const nextRunAt = await calculateNextRunTime(payload, scheduleBlocks, payload.timezone)
        await updateScheduleNextRun({
          scheduleId: payload.scheduleId,
          now,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        })
      },
      error: async ({ error, signal }) => {
        if (signal?.aborted) return false
        if (error instanceof WorkflowUsageLimitError) {
          logger.warn(
            `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping scheduled execution.`,
            {
              workflowId: payload.workflowId,
              message: error.message,
            }
          )
          await rescheduleSkippedExecution()
          return true
        }
        logger.error(
          `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
          error
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
        await updateScheduleNextRun({
          scheduleId: payload.scheduleId,
          now,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        })
        return true
      },
    },
  })
}
