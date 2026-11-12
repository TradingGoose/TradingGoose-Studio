import { db } from '@tradinggoose/db'
import { workflowLogWebhook, workflowLogWebhookDelivery } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { logsWebhookDelivery } from '@/background/logs-webhook-delivery'

const logger = createLogger('LogsEventEmitter')

export async function emitWorkflowExecutionCompleted(log: WorkflowExecutionLog): Promise<void> {
  const workflowId = log.workflowId ?? log.workflowSummary.id

  try {
    if (!workflowId) {
      logger.warn('Skipping workflow log webhook delivery without workflow identity', {
        logId: log.id,
        executionId: log.executionId,
      })
      return
    }

    const subscriptions = await db
      .select()
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.workflowId, workflowId), eq(workflowLogWebhook.active, true))
      )

    if (subscriptions.length === 0) {
      return
    }

    logger.debug(
      `Found ${subscriptions.length} active webhook subscriptions for workflow ${workflowId}`
    )

    for (const subscription of subscriptions) {
      const levelMatches = subscription.levelFilter?.includes(log.level) ?? true
      const triggerMatches = subscription.triggerFilter?.includes(log.trigger) ?? true

      if (!levelMatches || !triggerMatches) {
        logger.debug(`Skipping subscription ${subscription.id} due to filter mismatch`, {
          level: log.level,
          trigger: log.trigger,
          levelFilter: subscription.levelFilter,
          triggerFilter: subscription.triggerFilter,
        })
        continue
      }

      const deliveryId = uuidv4()

      await db.insert(workflowLogWebhookDelivery).values({
        id: deliveryId,
        subscriptionId: subscription.id,
        workflowId,
        workspaceId: log.workspaceId,
        executionId: log.executionId,
        workflowSummary: log.workflowSummary,
        subscriptionSnapshot: {
          url: subscription.url,
          secret: subscription.secret,
          includeFinalOutput: subscription.includeFinalOutput,
          includeTraceSpans: subscription.includeTraceSpans,
          includeRateLimits: subscription.includeRateLimits,
          includeUsageData: subscription.includeUsageData,
        },
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })

      await logsWebhookDelivery.trigger({ deliveryId })

      logger.info(`Enqueued webhook delivery ${deliveryId} for subscription ${subscription.id}`)
    }
  } catch (error) {
    logger.error('Failed to emit workflow execution completed event', {
      error,
      workflowId,
      executionId: log.executionId,
    })
  }
}
