import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { WebSocket, WebSocketServer } from 'ws'
import type * as Y from 'yjs'
import {
  buildReviewTargetDescriptorFromEnvelope,
  isEntityListSessionId,
} from '@/lib/copilot/review-sessions/identity'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import { saveSavedEntityYjsDocToDb } from '@/lib/yjs/server/apply-entity-state'
import {
  createEntityListBootstrapUpdate,
  createSavedReviewTargetBootstrapUpdate,
  getRuntimeStateFromDoc,
} from '@/lib/yjs/server/bootstrap-review-target'
import { authenticateYjsConnection, YjsAuthError } from './auth'
import { getExistingDocument, setupWSConnection } from './upstream-utils'

const logger = createLogger('YjsWsHandler')
const WORKFLOW_LIVE_PERSIST_DEBOUNCE_MS = 1500

interface YjsIncomingMessage extends IncomingMessage {
  yjsSessionId?: string
  yjsUserId?: string
  yjsBootstrapState?: Uint8Array
  yjsPersistLiveUpdates?: boolean
  yjsAccessMode?: ReviewAccessMode
}

async function persistLiveSavedDocument(docId: string, doc: Y.Doc): Promise<void> {
  if (isEntityListSessionId(docId)) {
    return
  }

  const metadata = doc.getMap<unknown>('metadata')
  if (
    metadata.get('entityId') !== docId ||
    metadata.get('draftSessionId') != null ||
    metadata.get('reviewSessionId') != null
  ) {
    return
  }

  const entityKind = metadata.get('entityKind')
  if (entityKind === 'workflow') {
    await saveWorkflowYjsDocToDb(docId, doc)
    return
  }

  if (entityKind === 'dashboard_layout') {
    await saveSavedEntityYjsDocToDb('dashboard_layout', docId, doc)
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
    .then(({ accessMode, bootstrapState, userId, resolvedSessionId, persistLiveUpdates }) => {
      const yjsReq = request as YjsIncomingMessage
      yjsReq.yjsSessionId = resolvedSessionId
      yjsReq.yjsUserId = userId
      yjsReq.yjsBootstrapState = bootstrapState
      yjsReq.yjsPersistLiveUpdates = persistLiveUpdates
      yjsReq.yjsAccessMode = accessMode

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
): Promise<{
  bootstrapState?: Uint8Array
  userId: string
  resolvedSessionId: string
  persistLiveUpdates: boolean
  accessMode: ReviewAccessMode
}> {
  const accessMode = parseAccessMode(url, pathSessionId)
  const { userId, envelope } = await authenticateYjsConnection(url)

  if (envelope.sessionId !== pathSessionId) {
    throw new YjsAuthError(409, 'Session ID mismatch')
  }

  const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
  assertAccessModeAllowed(accessMode, descriptor)
  const isListTarget = isEntityListSessionId(descriptor.yjsSessionId)

  const access = await verifyReviewTargetAccess(
    userId,
    {
      entityKind: descriptor.entityKind,
      entityId: descriptor.entityId,
      draftSessionId: descriptor.draftSessionId,
      reviewSessionId: descriptor.reviewSessionId,
      workspaceId: descriptor.workspaceId,
      ownerUserId: descriptor.ownerUserId ?? null,
      yjsSessionId: descriptor.yjsSessionId,
    },
    accessMode
  )

  if (!access.hasAccess) {
    throw new YjsAuthError(403, 'Forbidden')
  }

  // Every list connect follows a fresh snapshot fetch, which reseeds live
  // list docs from DB (routes/http.ts), so no upgrade-time reseed is needed.
  const liveDoc = await getExistingDocument(pathSessionId)

  const bootstrapped = liveDoc
    ? null
    : isListTarget
      ? await createEntityListBootstrapUpdate(
          descriptor.entityKind,
          descriptor.workspaceId as string,
          descriptor.ownerUserId ?? null
        )
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
    accessMode,
    persistLiveUpdates:
      accessMode === 'write' &&
      (descriptor.entityKind === 'workflow' || descriptor.entityKind === 'dashboard_layout') &&
      descriptor.entityId === pathSessionId,
  }
}

function parseAccessMode(url: URL, sessionId: string): ReviewAccessMode {
  const accessMode = url.searchParams.get('accessMode')
  if (accessMode !== 'read' && accessMode !== 'write') {
    throw new YjsAuthError(409, 'Invalid or missing access mode')
  }

  return accessMode
}

function assertAccessModeAllowed(
  accessMode: ReviewAccessMode,
  descriptor: ReviewTargetDescriptor
): void {
  const isListTarget = isEntityListSessionId(descriptor.yjsSessionId)
  if (isListTarget) {
    if (accessMode !== 'read') {
      throw new YjsAuthError(403, 'Entity-list websocket is read-only')
    }
    return
  }

  if (
    descriptor.entityKind === 'dashboard_layout' &&
    descriptor.entityId === descriptor.yjsSessionId
  ) {
    return
  }

  if (accessMode !== 'write') {
    throw new YjsAuthError(403, 'Yjs websocket requires write access')
  }
}

function ensureConnectionHandler(wss: WebSocketServer): void {
  if (wss.listenerCount('connection') > 0) {
    return
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const yjsReq = req as YjsIncomingMessage
    const docId = yjsReq.yjsSessionId

    if (!docId || !yjsReq.yjsAccessMode) {
      ws.close(4409, 'Missing session access')
      return
    }

    try {
      logger.info('Yjs connection established', { docId, userId: yjsReq.yjsUserId })
      setupWSConnection(ws, req, {
        docId,
        accessMode: yjsReq.yjsAccessMode,
        gc: true,
        bootstrapState: yjsReq.yjsBootstrapState,
        onDocumentIdle: yjsReq.yjsPersistLiveUpdates ? persistLiveSavedDocument : undefined,
        onDocumentUpdate: yjsReq.yjsPersistLiveUpdates ? persistLiveSavedDocument : undefined,
        onDocumentUpdateDebounceMs: WORKFLOW_LIVE_PERSIST_DEBOUNCE_MS,
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
