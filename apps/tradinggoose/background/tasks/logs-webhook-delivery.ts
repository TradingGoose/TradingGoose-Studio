import { task } from '@trigger.dev/sdk'

export const logsWebhookDelivery = task({
  id: 'logs-webhook-delivery',
  retry: { maxAttempts: 1 },
  run: async (payload: { deliveryId: string }, { signal }) => {
    const { executeLogsWebhookDelivery } = await import('../logs-webhook-delivery')
    return executeLogsWebhookDelivery(payload, signal)
  },
})
