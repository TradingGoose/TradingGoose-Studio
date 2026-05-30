import { db, webhook } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import type { MonitorWebhookProvider } from '@/lib/monitors/sources'

type MonitorDisableLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void
}

export async function disableMonitor({
  monitorId,
  provider,
  logger,
  ...metadata
}: {
  monitorId: string
  provider: MonitorWebhookProvider
  logger: MonitorDisableLogger
  [key: string]: unknown
}) {
  await db
    .update(webhook)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(and(eq(webhook.id, monitorId), eq(webhook.provider, provider)))

  logger.warn('Monitor disabled', {
    monitorId,
    provider,
    ...metadata,
  })
}
