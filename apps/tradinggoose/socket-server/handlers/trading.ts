import { createLogger } from '@/lib/logs/console/logger'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import {
  type TradingPortfolioSubscribePayload,
  type TradingPortfolioUnsubscribePayload,
  tradingPortfolioStreamManager,
} from '@/socket-server/trading/portfolio-manager'

const logger = createLogger('TradingPortfolioHandlers')

export function setupTradingPortfolioHandlers(socket: AuthenticatedSocket) {
  socket.on('trading-portfolio-subscribe', async (payload: TradingPortfolioSubscribePayload) => {
    try {
      const subscription = await tradingPortfolioStreamManager.subscribe(socket, payload)
      socket.emit('trading-portfolio-subscribed', subscription)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Trading portfolio subscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('trading-portfolio-subscribe-error', {
        error: message,
        provider: payload?.provider,
        credentialServiceId: payload?.credentialServiceId,
        channel: payload?.channel,
        accountId: payload?.accountId,
        window: payload?.window,
        clientSubscriptionId: payload?.clientSubscriptionId,
      })
    }
  })

  socket.on('trading-portfolio-unsubscribe', (payload: TradingPortfolioUnsubscribePayload) => {
    try {
      const removed = tradingPortfolioStreamManager.unsubscribe(socket, payload)
      socket.emit('trading-portfolio-unsubscribed', { subscriptions: removed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Trading portfolio unsubscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('trading-portfolio-unsubscribe-error', {
        error: message,
        provider: payload?.provider,
        credentialServiceId: payload?.credentialServiceId,
        channel: payload?.channel,
        accountId: payload?.accountId,
        clientSubscriptionId: payload?.clientSubscriptionId,
      })
    }
  })

  socket.on('trading-portfolio-refresh', (payload: TradingPortfolioUnsubscribePayload) => {
    try {
      const refreshed = tradingPortfolioStreamManager.refresh(socket, payload)
      socket.emit('trading-portfolio-refreshing', { subscriptions: refreshed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Trading portfolio refresh failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('trading-portfolio-error', {
        error: message,
        provider: payload?.provider,
        credentialServiceId: payload?.credentialServiceId,
        channel: payload?.channel,
        accountId: payload?.accountId,
        clientSubscriptionId: payload?.clientSubscriptionId,
      })
    }
  })

  socket.on('disconnect', () => {
    tradingPortfolioStreamManager.removeSocket(socket.id)
  })
}
