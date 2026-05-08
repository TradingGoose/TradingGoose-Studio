import { db } from '@tradinggoose/db'
import { workflowLogWebhookDelivery } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

export async function cancelActiveWebhookDeliveries(workflowId: string, webhookId: string) {
  await db
    .update(workflowLogWebhookDelivery)
    .set({
      status: 'cancelled',
      nextAttemptAt: null,
      errorMessage: 'Webhook subscription deleted',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowLogWebhookDelivery.subscriptionId, webhookId),
        eq(workflowLogWebhookDelivery.workflowId, workflowId),
        inArray(workflowLogWebhookDelivery.status, ['pending', 'in_progress'])
      )
    )
}
