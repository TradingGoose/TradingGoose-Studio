import type { IncomingMessage, ServerResponse } from 'http'
import { env } from '@/lib/env'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import type { RoomManager } from '@/socket-server/rooms/manager'

interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
}

type MonitorRuntimeStatus = 'not_initialized' | 'running' | 'degraded' | 'disabled'

type MonitorRuntimeHealth = {
  enabled: boolean
  status: MonitorRuntimeStatus
  reconcileEndpointEnabled: boolean
  lock: {
    mode: 'fail_closed'
    redisConfigured: boolean
    redisClientAvailable: boolean
    degraded: boolean
  }
}

type HttpHandlerOptions = {
  getMonitorRuntimeHealth?: () => MonitorRuntimeHealth
  onIndicatorMonitorsReconcile?: () => Promise<void> | void
}

const INTERNAL_SECRET_HEADER = 'x-internal-secret'

function isInternalRequestAuthorized(req: IncomingMessage): boolean {
  const providedHeader = req.headers[INTERNAL_SECRET_HEADER]
  const expectedSecret = env.INTERNAL_API_SECRET

  if (!expectedSecret) {
    return false
  }

  if (Array.isArray(providedHeader)) {
    return providedHeader.includes(expectedSecret)
  }

  return typeof providedHeader === 'string' && providedHeader === expectedSecret
}

function rejectUnauthorizedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger
): boolean {
  if (isInternalRequestAuthorized(req)) {
    return false
  }

  logger.warn('Denied unauthorized internal socket endpoint request', {
    path: req.url,
    method: req.method,
  })
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return true
}

function getDefaultMonitorRuntimeHealth(): MonitorRuntimeHealth {
  const redisConfigured = getRedisStorageMode() === 'redis'
  const redisClientAvailable = Boolean(getRedisClient())
  const degraded = redisConfigured && !redisClientAvailable

  return {
    enabled: false,
    status: degraded ? 'degraded' : 'not_initialized',
    reconcileEndpointEnabled: true,
    lock: {
      mode: 'fail_closed',
      redisConfigured,
      redisClientAvailable,
      degraded,
    },
  }
}

/**
 * Creates an HTTP request handler for the socket server
 * @param roomManager - RoomManager instance for managing workflow rooms and state
 * @param logger - Logger instance for logging requests and errors
 * @param options - Optional health status providers for runtime internals
 * @returns HTTP request handler function
 */
export function createHttpHandler(
  roomManager: RoomManager,
  logger: Logger,
  options?: HttpHandlerOptions
) {
  const resolveMonitorRuntimeHealth =
    options?.getMonitorRuntimeHealth ?? getDefaultMonitorRuntimeHealth
  const triggerIndicatorMonitorsReconcile = options?.onIndicatorMonitorsReconcile

  return async (req: IncomingMessage, res: ServerResponse) => {
    // If the response is already handled (e.g., by Socket.IO), bail out to avoid double writes
    if (res.writableEnded || res.headersSent) {
      return
    }

    // Let Socket.IO own its transport endpoints entirely
    if (req.url?.startsWith('/socket.io')) {
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          connections: roomManager.getTotalActiveConnections(),
          monitorRuntime: resolveMonitorRuntimeHealth(),
        })
      )
      return
    }

    if (req.method === 'POST' && req.url === '/internal/indicator-monitors/reconcile') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      try {
        await triggerIndicatorMonitorsReconcile?.()
        logger.info('Accepted indicator monitor reconcile request')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        logger.error('Failed to process indicator monitor reconcile request', { error })
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to process reconcile request' }))
      }
      return
    }

    // Handle workflow deletion notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-deleted') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowDeletion(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow deletion notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process deletion notification' }))
        }
      })
      return
    }

    // Handle workflow update notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-updated') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowUpdate(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow update notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process update notification' }))
        }
      })
      return
    }

    // Handle copilot workflow edit notifications from the main API
    if (req.method === 'POST' && req.url === '/api/copilot-workflow-edit') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, description } = JSON.parse(body)
          roomManager.handleCopilotWorkflowEdit(workflowId, description)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling copilot workflow edit notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process copilot edit notification' }))
        }
      })
      return
    }

    // Handle workflow revert notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-reverted') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, timestamp } = JSON.parse(body)
          roomManager.handleWorkflowRevert(workflowId, timestamp)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow revert notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process revert notification' }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
