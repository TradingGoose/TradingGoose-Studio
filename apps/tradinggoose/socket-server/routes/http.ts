import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import { env } from '@/lib/env'
import {
  buildReviewTargetDescriptorFromEnvelope,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import { getRuntimeStateFromDoc, getRuntimeStateFromUpdate } from '@/lib/yjs/server/bootstrap-review-target'
import { getState } from '@/socket-server/yjs/persistence'
import { getExistingDocument } from '@/socket-server/yjs/upstream-utils'

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
  getConnectionCount?: () => number
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

export function createHttpHandler(
  logger: Logger,
  options?: HttpHandlerOptions
) {
  const resolveMonitorRuntimeHealth =
    options?.getMonitorRuntimeHealth ?? getDefaultMonitorRuntimeHealth
  const resolveConnectionCount = options?.getConnectionCount ?? (() => 0)
  const triggerIndicatorMonitorsReconcile = options?.onIndicatorMonitorsReconcile

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (res.writableEnded || res.headersSent) {
      return
    }

    if (req.url?.startsWith('/socket.io')) {
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          connections: resolveConnectionCount(),
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

    if (req.method === 'GET' && req.url) {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      const yjsSnapshotMatch = parsedUrl.pathname.match(/^\/internal\/yjs\/sessions\/([^/]+)\/snapshot$/)

      if (yjsSnapshotMatch) {
        if (rejectUnauthorizedRequest(req, res, logger)) return

        const sessionId = decodeURIComponent(yjsSnapshotMatch[1])
        const queryParams: Record<string, string | undefined> = {}
        parsedUrl.searchParams.forEach((value, key) => {
          queryParams[key] = value
        })

        try {
          const envelope = parseYjsTransportEnvelope(queryParams)
          if (envelope.sessionId !== sessionId) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Session ID mismatch', sessionId }))
            return
          }

          const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
          const liveDoc = await getExistingDocument(sessionId)
          const state = liveDoc ? Y.encodeStateAsUpdate(liveDoc) : await getState(sessionId)

          if (!state) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Session not found', sessionId }))
            return
          }

          const runtime = liveDoc ? getRuntimeStateFromDoc(liveDoc) : getRuntimeStateFromUpdate(state)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              snapshotBase64: Buffer.from(state).toString('base64'),
              descriptor,
              runtime,
            })
          )
        } catch (error) {
          logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to get snapshot' }))
        }
        return
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
