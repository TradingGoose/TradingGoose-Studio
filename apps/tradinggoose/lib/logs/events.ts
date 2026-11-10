import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { workflowLogWebhook, workflowLogWebhookDelivery } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import {
  verifyWorkflowFinancialAcceptance,
  type WorkflowFinancialLog,
} from '@/lib/logs/execution/financial-acceptance'
import { logsWebhookDelivery } from '@/background/logs-webhook-delivery'

const logger = createLogger('LogsEventEmitter')

export async function emitWorkflowExecutionCompleted(
  log: WorkflowFinancialLog & { level: string; trigger: string }
): Promise<void> {
  // Financial refusal is required, not an optional webhook transport failure.
  await verifyWorkflowFinancialAcceptance(log)
  if (!log.executionId) throw new Error('Verified workflow execution identity is missing')
  const summary = log.workflowSummary as { id: string }
  const workflowId = log.workflowId ?? summary.id

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

      const deliveryId: string = `completion:${createHash('sha256')
        .update(JSON.stringify([log.workspaceId, log.executionId, log.id, subscription.id]))
        .digest('hex')}`

      await db
        .insert(workflowLogWebhookDelivery)
        .values({
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
        .onConflictDoNothing({ target: workflowLogWebhookDelivery.id })
      const [delivery]: Array<typeof workflowLogWebhookDelivery.$inferSelect> = await db
        .select()
        .from(workflowLogWebhookDelivery)
        .where(eq(workflowLogWebhookDelivery.id, deliveryId))
        .limit(1)
      if (
        !delivery ||
        delivery.id !== deliveryId ||
        (delivery.workflowId ?? (delivery.workflowSummary as { id?: string })?.id) !== workflowId ||
        delivery.executionId !== log.executionId ||
        delivery.workspaceId !== log.workspaceId ||
        delivery.subscriptionId !== subscription.id ||
        !delivery.subscriptionSnapshot
      )
        throw new Error('Completion publication scope/readback differs')
      // Keep the first frozen destination and all existing attempt/status state.
      if (
        delivery.status !== 'pending' ||
        (delivery.nextAttemptAt && delivery.nextAttemptAt.getTime() > Date.now())
      )
        continue
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
