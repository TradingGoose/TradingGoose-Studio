import { env } from '@/lib/env'

type Logger = {
  warn: (message: string, ...args: unknown[]) => void
}

export const notifyIndicatorMonitorsReconcile = async ({
  requestId,
  logger,
}: {
  requestId: string
  logger: Logger
}) => {
  try {
    const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
    const response = await fetch(`${socketUrl}/internal/indicator-monitors/reconcile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ requestId, at: new Date().toISOString() }),
    })

    if (!response.ok) {
      logger.warn(`[${requestId}] Indicator monitor reconcile notification failed`, {
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn(`[${requestId}] Indicator monitor reconcile notification error`, { error })
  }
}
