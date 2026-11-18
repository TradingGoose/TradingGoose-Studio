import { createLogger } from '@/lib/logs/console/logger'
import {
  type MarketSubscribePayload,
  MarketSubscriptionCancelledError,
  type MarketUnsubscribePayload,
  marketStreamManager,
} from '@/socket-server/market/manager'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'

const logger = createLogger('MarketHandlers')

export function setupMarketHandlers(socket: AuthenticatedSocket) {
  socket.on('market-subscribe', async (payload: MarketSubscribePayload) => {
    try {
      await marketStreamManager.subscribe(socket, payload, 'workspace')
    } catch (error) {
      if (error instanceof MarketSubscriptionCancelledError) return
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Market subscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('market-subscribe-error', {
        message,
        clientSubscriptionId: payload?.clientSubscriptionId,
      })
    }
  })

  socket.on('market-unsubscribe', (payload: MarketUnsubscribePayload) => {
    try {
      marketStreamManager.unsubscribe(socket, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Market unsubscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
    }
  })

  socket.on('disconnect', () => {
    marketStreamManager.removeSocket(socket.id)
  })
}
