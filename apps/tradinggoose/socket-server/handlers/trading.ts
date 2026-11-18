import { createLogger } from '@/lib/logs/console/logger'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import {
  type TradingPortfolioRefreshPayload,
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
        workspaceId: payload?.workspaceId,
        provider: payload?.provider,
        serviceId: payload?.serviceId,
        channel: payload?.channel,
        portfolioIdentity: payload?.portfolioIdentity,
        window: payload?.window,
        clientSubscriptionId: payload?.clientSubscriptionId,
      })
    }
  })

  socket.on('trading-portfolio-unsubscribe', (payload: TradingPortfolioUnsubscribePayload) => {
    try {
      tradingPortfolioStreamManager.unsubscribe(socket, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Trading portfolio unsubscribe failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
    }
  })

  socket.on('trading-portfolio-refresh', (payload: TradingPortfolioRefreshPayload) => {
    try {
      tradingPortfolioStreamManager.refresh(socket, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Trading portfolio refresh failed', {
        socketId: socket.id,
        userId: socket.userId,
        error: message,
      })
      socket.emit('trading-portfolio-error', {
        error: message,
        subscriptionId: payload?.subscriptionId,
        workspaceId: payload?.workspaceId,
        provider: payload?.provider,
        serviceId: payload?.serviceId,
        channel: payload?.channel,
        portfolioIdentity: payload?.portfolioIdentity,
        clientSubscriptionId: payload?.clientSubscriptionId,
        refreshId: payload?.refreshId,
      })
    }
  })

  socket.on('disconnect', () => {
    tradingPortfolioStreamManager.removeSocket(socket.id)
  })
}
