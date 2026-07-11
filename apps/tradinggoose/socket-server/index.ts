import { createServer, type IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer } from 'ws'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { closeRedisConnection } from '@/lib/redis'
import { createSocketIOServer } from '@/socket-server/config/socket'
import { setupAllHandlers } from '@/socket-server/handlers'
import { IndicatorMonitorRuntime } from '@/socket-server/market/indicator-monitor-runtime'
import { type AuthenticatedSocket, authenticateSocket } from '@/socket-server/middleware/auth'
import { createHttpHandler } from '@/socket-server/routes/http'
import { tradingPortfolioStreamManager } from '@/socket-server/trading/portfolio-manager'
import { PortfolioMonitorRuntime } from '@/socket-server/trading/portfolio-monitor-runtime'
import {
  isYjsUpgradeRequest,
  shieldNonYjsUpgradeListeners,
} from '@/socket-server/yjs/upgrade-routing'
import { drainAllDocuments } from '@/socket-server/yjs/upstream-utils'
import { handleYjsUpgrade } from '@/socket-server/yjs/ws-handler'

const logger = createLogger('CollaborativeSocketServer')

// Enhanced server configuration - HTTP server will be configured with handler after all dependencies are set up
const httpServer = createServer()

// Yjs WebSocket server - noServer mode, upgrade handled manually
const yjsWss = new WebSocketServer({ noServer: true })
let isShuttingDown = false

// Register the Yjs upgrade handler before Socket.IO and then shield the
// remaining upgrade listeners so Engine.IO never sees /yjs/* requests.
const yjsUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  if (!isYjsUpgradeRequest(request)) {
    return
  }
  if (isShuttingDown) {
    socket.destroy()
    return
  }

  handleYjsUpgrade(yjsWss, request, socket, head)
}

httpServer.on('upgrade', yjsUpgradeListener)

const io = createSocketIOServer(httpServer)
shieldNonYjsUpgradeListeners(httpServer, yjsUpgradeListener)

const indicatorMonitorRuntime = new IndicatorMonitorRuntime(logger)
const portfolioMonitorRuntime = new PortfolioMonitorRuntime(logger)
const monitorRuntimes = {
  indicator: indicatorMonitorRuntime,
  portfolio: portfolioMonitorRuntime,
}

io.use(authenticateSocket)

const httpHandler = createHttpHandler(logger, {
  getMonitorRuntimeHealth: () =>
    Object.fromEntries(
      Object.entries(monitorRuntimes).map(([source, runtime]) => [source, runtime.getHealth()])
    ),
  getConnectionCount: () => yjsWss.clients.size + (io.engine?.clientsCount ?? 0),
  onMonitorsReconcile: async () => {
    await Promise.all(Object.values(monitorRuntimes).map((runtime) => runtime.requestReconcile()))
  },
})
httpServer.on('request', httpHandler)

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  // Don't exit in production, just log
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

httpServer.on('error', (error) => {
  logger.error('HTTP server error:', error)
})

io.engine.on('connection_error', (err) => {
  logger.error('Socket.IO connection error:', {
    req: err.req?.url,
    code: err.code,
    message: err.message,
    context: err.context,
  })
})

io.on('connection', (socket: AuthenticatedSocket) => {
  logger.info(`New socket connection: ${socket.id}`)

  setupAllHandlers(socket)
})

httpServer.on('request', (req, res) => {
  logger.info(`🌐 HTTP Request: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
    host: req.headers.host,
    timestamp: new Date().toISOString(),
  })
})

io.engine.on('connection_error', (err) => {
  logger.error('❌ Engine.IO Connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
    req: err.req
      ? {
          url: err.req.url,
          method: err.req.method,
          headers: err.req.headers,
        }
      : 'No request object',
  })
})

const PORT = Number(env.PORT || env.SOCKET_PORT || 3002)

logger.info('Starting Socket.IO server...', {
  port: PORT,
  nodeEnv: env.NODE_ENV,
  hasDatabase: !!env.DATABASE_URL,
  hasAuth: !!env.BETTER_AUTH_SECRET,
})

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`Socket.IO server running on port ${PORT}`)
  logger.info(`🏥 Health check available at: http://localhost:${PORT}/health`)
  Object.entries(monitorRuntimes).forEach(([source, runtime]) => {
    void runtime.start().catch((error) => {
      logger.error(`Failed to start ${source} monitor runtime`, { error })
    })
  })
})

httpServer.on('error', (error) => {
  logger.error('❌ Server failed to start:', error)
  process.exit(1)
})

const shutdown = async () => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info('Shutting down Socket.IO server...')
  try {
    await drainAllDocuments()
  } catch (error) {
    logger.error('Failed to drain realtime state cleanly', { error })
    return
  }

  tradingPortfolioStreamManager.stop()
  const monitorEntries = Object.entries(monitorRuntimes)
  const monitorResults = await Promise.allSettled(
    monitorEntries.map(([, runtime]) => runtime.stop())
  )
  monitorResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(`Failed to stop ${monitorEntries[index][0]} monitor runtime cleanly`, {
        error: result.reason,
      })
    }
  })

  await new Promise<void>((resolve) => {
    io.close((error) => {
      if (error) logger.error('Failed to close Socket.IO server cleanly', { error })
      resolve()
    })
  })
  await closeRedisConnection().catch((error) => {
    logger.error('Failed to close Redis connection cleanly', { error })
  })
  logger.info('Socket.IO server closed')
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
