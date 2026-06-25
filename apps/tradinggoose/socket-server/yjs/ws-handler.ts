import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { WebSocket, WebSocketServer } from 'ws'
import type * as Y from 'yjs'
import { buildReviewTargetDescriptorFromEnvelope } from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { createLogger } from '@/lib/logs/console/logger'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { saveSavedEntityYjsDocToDb } from '@/lib/yjs/server/apply-entity-state'
import {
  createSavedReviewTargetBootstrapUpdate,
  getRuntimeStateFromDoc,
} from '@/lib/yjs/server/bootstrap-review-target'
import { authenticateYjsConnection, YjsAuthError } from './auth'
import { getExistingDocument, setupWSConnection } from './upstream-utils'

const logger = createLogger('YjsWsHandler')
const savedEntityKinds = new Set<SavedEntityKind>([
  'skill',
  'custom_tool',
  'indicator',
  'knowledge_base',
  'mcp_server',
])

interface YjsIncomingMessage extends IncomingMessage {
  yjsSessionId?: string
  yjsUserId?: string
  yjsBootstrapState?: Uint8Array
}

async function persistIdleDocument(docId: string, doc: Y.Doc): Promise<void> {
  const metadata = doc.getMap<unknown>('metadata')
  const entityKind = metadata.get('entityKind')
  if (
    metadata.get('entityId') !== docId ||
    metadata.get('draftSessionId') !== null ||
    metadata.get('reviewSessionId') !== null
  ) {
    return
  }

  if (entityKind === 'workflow') {
    await saveWorkflowYjsDocToDb(docId, doc)
    return
  }
  if (typeof entityKind === 'string' && savedEntityKinds.has(entityKind as SavedEntityKind)) {
    await saveSavedEntityYjsDocToDb(entityKind as SavedEntityKind, docId, doc)
  }
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
    .then(({ bootstrapState, userId, resolvedSessionId }) => {
      const yjsReq = request as YjsIncomingMessage
      yjsReq.yjsSessionId = resolvedSessionId
      yjsReq.yjsUserId = userId
      yjsReq.yjsBootstrapState = bootstrapState

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

      logger.error('Yjs upgrade error', { error })
      rejectUpgrade(socket, 500, 'Internal error')
    })
}

async function authenticateAndPrepareUpgrade(
  pathSessionId: string,
  url: URL
): Promise<{ bootstrapState?: Uint8Array; userId: string; resolvedSessionId: string }> {
  const accessMode = parseAccessMode(url)
  const { userId, envelope } = await authenticateYjsConnection(url)

  if (envelope.sessionId !== pathSessionId) {
    throw new YjsAuthError(409, 'Session ID mismatch')
  }

  const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)

  const access = await verifyReviewTargetAccess(
    userId,
    {
      entityKind: descriptor.entityKind,
      entityId: descriptor.entityId,
      draftSessionId: descriptor.draftSessionId,
      reviewSessionId: descriptor.reviewSessionId,
      workspaceId: descriptor.workspaceId,
      yjsSessionId: descriptor.yjsSessionId,
    },
    accessMode
  )

  if (!access.hasAccess) {
    throw new YjsAuthError(403, 'Forbidden')
  }

  const liveDoc = await getExistingDocument(pathSessionId)
  const bootstrapped = liveDoc
    ? null
    : descriptor.entityId
      ? await createSavedReviewTargetBootstrapUpdate(descriptor)
      : null
  const runtime = liveDoc ? getRuntimeStateFromDoc(liveDoc) : bootstrapped?.runtime

  if (!runtime) {
    throw new YjsAuthError(409, 'Review target is not bootstrapped')
  }

  if (runtime.docState === 'expired') {
    throw new YjsAuthError(409, 'Review target expired')
  }

  return {
    bootstrapState: bootstrapped?.state,
    userId,
    resolvedSessionId: pathSessionId,
  }
}

function parseAccessMode(url: URL): 'write' {
  const accessMode = url.searchParams.get('accessMode')
  if (accessMode !== 'read' && accessMode !== 'write') {
    throw new YjsAuthError(409, 'Invalid or missing access mode')
  }

  if (accessMode !== 'write') {
    throw new YjsAuthError(403, 'Yjs websocket requires write access')
  }

  return 'write'
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
      setupWSConnection(ws, req, {
        docId,
        gc: true,
        bootstrapState: yjsReq.yjsBootstrapState,
        onDocumentIdle: persistIdleDocument,
      })
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
