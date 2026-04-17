import { db, workflow, workflowSchedule } from '@tradinggoose/db'
import { and, eq, lte, not } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ScheduledExecuteAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  const now = new Date()

  try {
    const dueSchedules = await db
      .select()
      .from(workflowSchedule)
      .where(
        and(lte(workflowSchedule.nextRunAt, now), not(eq(workflowSchedule.status, 'disabled')))
      )

    logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)
    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    const queuedSchedules = await Promise.all(
      dueSchedules.map(async (schedule) => {
        try {
          const [workflowRecord] = await db
            .select({
            workspaceId: workflow.workspaceId,
            pinnedApiKeyId: workflow.pinnedApiKeyId,
          })
          .from(workflow)
          .where(eq(workflow.id, schedule.workflowId))
          .limit(1)

        if (!workflowRecord) {
          logger.warn(
            `[${requestId}] Workflow ${schedule.workflowId} not found for schedule ${schedule.id}`,
          )
          return null
        }

        const actorUserId = await getApiKeyOwnerUserId(
          workflowRecord.pinnedApiKeyId,
        )

        if (!actorUserId) {
          logger.warn(
            `[${requestId}] Skipping schedule ${schedule.id}: pinned API key required to attribute usage.`,
          )
          return null
        }

        const pendingExecutionId = `schedule_execution:${schedule.id}:${schedule.nextRunAt?.toISOString() ?? now.toISOString()}`
        const payload = {
          executionId: pendingExecutionId,
          scheduleId: schedule.id,
          workflowId: schedule.workflowId,
          blockId: schedule.blockId || undefined,
          cronExpression: schedule.cronExpression || undefined,
          lastRanAt: schedule.lastRanAt?.toISOString(),
          failedCount: schedule.failedCount || 0,
          timezone: schedule.timezone,
          now: now.toISOString(),
        }

        const handle = await enqueuePendingExecution({
          executionType: 'schedule',
          pendingExecutionId,
          workflowId: schedule.workflowId,
          workspaceId: workflowRecord.workspaceId,
          userId: actorUserId,
          source: 'schedule',
          orderingKey: `schedule:${schedule.id}`,
          requestId,
          payload,
        })

        logger.info(
          `[${requestId}] Queued schedule execution ${handle.pendingExecutionId} for workflow ${schedule.workflowId}`,
        )
        return handle
      } catch (error) {
        if (isPendingExecutionLimitError(error)) {
          logger.warn(
            `[${requestId}] Pending backlog full for schedule ${schedule.id}`,
            {
              workflowId: schedule.workflowId,
              pendingCount: error.details.pendingCount,
              maxPendingCount: error.details.maxPendingCount,
            },
          )
          return null
        }

        if (error instanceof TriggerExecutionUnavailableError) {
          throw error
        }

        logger.error(
          `[${requestId}] Failed to trigger schedule execution for workflow ${schedule.workflowId}`,
          error
        )
        return null
      }
      })
    )
    const queuedCount = queuedSchedules.filter((result) => result !== null).length

    logger.info(
      `[${requestId}] Queued ${queuedCount} schedule executions to pending execution`,
    )

    return NextResponse.json({
      message: 'Scheduled workflow executions processed',
      executedCount: queuedCount,
    })
  } catch (error: any) {
    if (error instanceof TriggerExecutionUnavailableError) {
      logger.error(`[${requestId}] Scheduled execution blocked because Trigger.dev is unavailable`)
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
