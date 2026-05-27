import { env, getInternalRealtimeUrl } from '@/lib/env'

type Logger = {
  warn: (message: string, ...args: unknown[]) => void
}

export const notifyMonitorsReconcile = async ({
  requestId,
  logger,
}: {
  requestId: string
  logger: Logger
}) => {
  try {
    const socketUrl = getInternalRealtimeUrl()
    const response = await fetch(`${socketUrl}/internal/monitors/reconcile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ requestId, at: new Date().toISOString() }),
    })

    if (!response.ok) {
      logger.warn(`[${requestId}] Monitor reconcile notification failed`, {
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn(`[${requestId}] Monitor reconcile notification error`, { error })
  }
}
