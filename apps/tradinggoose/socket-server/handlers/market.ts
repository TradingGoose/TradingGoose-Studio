import { createLogger } from '@/lib/logs/console/logger'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import {
  type MarketSubscribePayload,
  type MarketUnsubscribePayload,
  marketStreamManager,
} from '@/socket-server/market/manager'

const logger = createLogger('MarketHandlers')

export function setupMarketHandlers(socket: AuthenticatedSocket) {
  socket.on('market-subscribe', async (payload: MarketSubscribePayload) => {
    try {
      const subscription = await marketStreamManager.subscribe(socket, payload)
      socket.emit('market-subscribed', subscription)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Market subscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('market-subscribe-error', { error: message })
    }
  })

  socket.on('market-unsubscribe', (payload: MarketUnsubscribePayload) => {
    try {
      const removed = marketStreamManager.unsubscribe(socket, payload)
      socket.emit('market-unsubscribed', { subscriptions: removed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Market unsubscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('market-unsubscribe-error', { error: message })
    }
  })

  socket.on('disconnect', () => {
    marketStreamManager.removeSocket(socket.id)
  })
}
