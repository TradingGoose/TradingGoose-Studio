import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { WebSocket, WebSocketServer } from 'ws'
import {
  buildReviewTargetDescriptorFromEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { createLogger } from '@/lib/logs/console/logger'
import {
  bootstrapReviewTarget,
  ReviewTargetBootstrapError,
} from '@/lib/yjs/server/bootstrap-review-target'
import { authenticateYjsConnection, YjsAuthError } from './auth'
import { getState, storeState } from './persistence'
import { setPersistence, setupWSConnection } from './upstream-utils'

const logger = createLogger('YjsWsHandler')

interface YjsIncomingMessage extends IncomingMessage {
  yjsSessionId?: string
  yjsUserId?: string
}

export function handleYjsUpgrade(
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  const url = new URL(request.url || '', `http://${request.headers.host}`)
  const pathname = url.pathname
  const match = pathname.match(/^\/yjs\/([^/]+)$/)

  if (!match || !match[1]) {
    rejectUpgrade(socket, 400, 'Invalid Yjs path')
    return
  }

  const yjsSessionId = decodeURIComponent(match[1])

  void authenticateAndPrepareUpgrade(yjsSessionId, url)
    .then(({ userId, resolvedSessionId }) => {
      setPersistence(resolvedSessionId, { getState, storeState })

      const yjsReq = request as YjsIncomingMessage
      yjsReq.yjsSessionId = resolvedSessionId
      yjsReq.yjsUserId = userId

      ensureConnectionHandler(wss)
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, request)
      })
    })
    .catch((error) => {
      if (error instanceof YjsAuthError) {
        rejectUpgrade(socket, error.code, error.message)
        return
      }

      if (error instanceof ReviewTargetBootstrapError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 500
        rejectUpgrade(socket, status, error.message)
        return
      }

      logger.error('Yjs upgrade error', { error })
      rejectUpgrade(socket, 500, 'Internal error')
    })
}

async function authenticateAndPrepareUpgrade(
  pathSessionId: string,
  url: URL
): Promise<{ userId: string; resolvedSessionId: string }> {
  const { userId, envelope } = await authenticateYjsConnection(url)

  if (envelope.sessionId !== pathSessionId) {
    throw new YjsAuthError(409, 'Session ID mismatch')
  }

  const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)

  // These two steps must be sequential: bootstrapReviewTarget depends on
  // `access.workspaceId` to resolve the canonical workspace, so it cannot
  // run in parallel with the access check.
  const access = await verifyReviewTargetAccess(userId, {
    entityKind: descriptor.entityKind,
    entityId: descriptor.entityId,
    draftSessionId: descriptor.draftSessionId,
    reviewSessionId: descriptor.reviewSessionId,
    workspaceId: descriptor.workspaceId,
    yjsSessionId: descriptor.yjsSessionId,
  }, { requireWrite: true })

  if (!access.hasAccess) {
    throw new YjsAuthError(403, 'Forbidden')
  }

  const resolved = await bootstrapReviewTarget({
    ...descriptor,
    workspaceId: access.workspaceId ?? descriptor.workspaceId,
  })

  if (resolved.runtime.docState === 'expired') {
    throw new YjsAuthError(409, 'Review target expired')
  }

  if (resolved.descriptor.yjsSessionId !== pathSessionId) {
    throw new YjsAuthError(409, 'Resolved Yjs session mismatch')
  }

  return {
    userId,
    resolvedSessionId: resolved.descriptor.yjsSessionId,
  }
}

function ensureConnectionHandler(wss: WebSocketServer): void {
  if (wss.listenerCount('connection') > 0) {
    return
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const yjsReq = req as YjsIncomingMessage
    const docId = yjsReq.yjsSessionId

    if (!docId) {
      ws.close(4409, 'Missing session ID')
      return
    }

    try {
      logger.info('Yjs connection established', { docId, userId: yjsReq.yjsUserId })
      setupWSConnection(ws, req, { docId, gc: true })
    } catch (error) {
      logger.error('Failed to attach Yjs connection', { docId, error })
      ws.close(4409, 'Failed to attach Yjs session')
    }
  })
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  const response = [
    `HTTP/1.1 ${statusCode} ${message}`,
    'Content-Type: text/plain',
    `Content-Length: ${Buffer.byteLength(message)}`,
    '',
    message,
  ].join('\r\n')

  socket.write(response)
  socket.destroy()
}
