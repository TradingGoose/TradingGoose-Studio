import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { RawData, WebSocket, WebSocketServer } from 'ws'
import type * as Y from 'yjs'
import {
  buildReviewTargetDescriptorFromEnvelope,
  isEntityListSessionId,
  parseDashboardColorPairSessionId,
  parseDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import {
  type ReviewAccessMode,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_DOCUMENT_REJECTED,
  YJS_CLOSE_CODE_RETRY_REQUIRED,
} from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import { SavedEntityPersistenceError } from '@/lib/yjs/entity-state'
import {
  saveDashboardYjsDocsToDb,
  saveSavedEntityYjsDocToDb,
} from '@/lib/yjs/server/apply-entity-state'
import { initializeSavedReviewTargetDocument } from '@/lib/yjs/server/bootstrap-review-target'
import { YjsSessionAdmissionError } from '@/lib/yjs/server/revocation-fence'
import { authenticateYjsConnection, YjsAuthError } from './auth'
import { bindEntityListSession, refreshActiveEntityListSession } from './entity-list-session'
import {
  acquireDocument,
  type DocumentAdmission,
  persistStagedDocuments,
  setupWSConnection,
} from './upstream-utils'

const logger = createLogger('YjsWsHandler')
const SAVED_DOCUMENT_LIVE_PERSIST_DEBOUNCE_MS = 1500
const MAX_PENDING_MESSAGE_COUNT = 64

function manualPersistenceHandler(
  accessMode: ReviewAccessMode,
  descriptor: ReviewTargetDescriptor
) {
  if (
    accessMode !== 'write' ||
    !descriptor.entityId ||
    !descriptor.workspaceId ||
    descriptor.draftSessionId !== null ||
    descriptor.reviewSessionId !== null
  ) {
    return undefined
  }
  switch (descriptor.entityKind) {
    case 'skill':
    case 'custom_tool':
    case 'indicator':
    case 'knowledge_base':
    case 'mcp_server':
      break
    default:
      return undefined
  }
  const { entityId, entityKind, workspaceId } = descriptor
  return async (doc: Y.Doc, requestId: string, identityName?: string) => {
    if (identityName !== undefined && !identityName.trim()) {
      throw new SavedEntityPersistenceError(400, 'identity.name is required')
    }
    await persistStagedDocuments(
      [{ doc }],
      ([staged]) =>
        saveSavedEntityYjsDocToDb(
          entityKind,
          entityId,
          workspaceId,
          staged!,
          identityName ? { identity: { name: identityName } } : undefined
        ),
      requestId
    )
    await refreshActiveEntityListSession(entityKind, workspaceId).catch(() => undefined)
  }
}

function livePersistenceHandler(accessMode: ReviewAccessMode, descriptor: ReviewTargetDescriptor) {
  if (
    accessMode !== 'write' ||
    !descriptor.entityId ||
    descriptor.draftSessionId !== null ||
    descriptor.reviewSessionId !== null ||
    (descriptor.entityKind !== 'workflow' &&
      descriptor.entityKind !== 'watchlist' &&
      descriptor.entityKind !== 'dashboard_widget' &&
      descriptor.entityKind !== 'dashboard_color_pair')
  ) {
    return undefined
  }
  const entityId = descriptor.entityId
  return async (_docId: string, staged: Y.Doc) => {
    if (descriptor.entityKind === 'workflow') {
      await saveWorkflowYjsDocToDb(entityId, staged)
      return
    }
    if (!descriptor.workspaceId) {
      throw new SavedEntityPersistenceError(409, 'Yjs persistence workspace is required')
    }
    if (descriptor.entityKind === 'watchlist') {
      await saveSavedEntityYjsDocToDb('watchlist', entityId, descriptor.workspaceId, staged)
      await refreshActiveEntityListSession('watchlist', descriptor.workspaceId).catch(
        () => undefined
      )
      return
    }
    if (!descriptor.ownerUserId) {
      throw new SavedEntityPersistenceError(409, 'Dashboard persistence owner is required')
    }
    const scope = { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId }
    const part = descriptor.entityKind === 'dashboard_widget' ? 'widget' : 'colorPair'
    const child =
      descriptor.entityKind === 'dashboard_widget'
        ? parseDashboardWidgetSessionId(descriptor.yjsSessionId)
        : parseDashboardColorPairSessionId(descriptor.yjsSessionId)
    if (!child) {
      throw new SavedEntityPersistenceError(409, 'Dashboard persistence target is invalid')
    }
    await saveDashboardYjsDocsToDb(scope, {
      layoutId: child.layoutId,
      [part]: { sessionId: descriptor.yjsSessionId, doc: staged },
    })
  }
}

export function handleYjsUpgrade(
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  canAcceptConnection: () => boolean = () => true
): void {
  const url = new URL(request.url || '', `http://${request.headers.host}`)
  const match = url.pathname.match(/^\/yjs\/([^/]+)$/)

  if (!match || !match[1]) {
    rejectUpgrade(socket, 400, 'Invalid Yjs path')
    return
  }

  const yjsSessionId = decodeURIComponent(match[1])
  const rejectConnection = (ws: WebSocket, error: unknown) => {
    logger.error('Failed to attach Yjs connection', { docId: yjsSessionId, error })
    ws.close(yjsConnectionRejectionCode(error), 'Failed to attach Yjs session')
  }

  const pendingMessages: Uint8Array[] = []
  let pendingMessageBytes = 0
  let awaitingAdmission = true
  let ws!: WebSocket

  function detachPendingListeners() {
    ws.off('message', collectPendingMessage)
    ws.off('close', abandonPendingMessages)
    ws.off('error', abandonPendingMessages)
  }
  function abandonPendingMessages() {
    if (!awaitingAdmission) return
    awaitingAdmission = false
    pendingMessages.length = 0
    detachPendingListeners()
  }
  function collectPendingMessage(data: RawData) {
    if (!awaitingAdmission) return
    const messageBytes = Array.isArray(data)
      ? data.reduce((total, fragment) => total + fragment.byteLength, 0)
      : data.byteLength
    if (
      pendingMessages.length >= MAX_PENDING_MESSAGE_COUNT ||
      pendingMessageBytes + messageBytes > wss.options.maxPayload!
    ) {
      abandonPendingMessages()
      ws.close(1009, 'Yjs message exceeds transport payload limit')
      return
    }
    pendingMessageBytes += messageBytes
    pendingMessages.push(copyWebSocketMessage(data))
  }

  wss.handleUpgrade(request, socket, head, (upgraded: WebSocket) => {
    ws = upgraded
    ws.binaryType = 'arraybuffer'
    ws.on('message', collectPendingMessage)
    ws.once('close', abandonPendingMessages)
    ws.once('error', abandonPendingMessages)
  })

  void (async () => {
    if (!canAcceptConnection()) throw new YjsSessionAdmissionError(yjsSessionId)
    const authenticated = await authenticateYjsUpgrade(yjsSessionId, url)

    await acquireDocument(
      yjsSessionId,
      {
        workspaceId: authenticated.descriptor.workspaceId,
        admission: authenticated,
        initialize: (_doc, admission, readStore) => {
          if (!admission) throw new YjsAuthError(503, 'Yjs authorization is unavailable')
          if (isEntityListSessionId(admission.descriptor.yjsSessionId)) {
            bindEntityListSession(
              _doc,
              admission.descriptor.entityKind as ReviewEntityKind,
              admission.descriptor.workspaceId as string,
              admission.descriptor.ownerUserId ?? null
            )
            return
          }
          return initializeSavedReviewTargetDocument(admission.descriptor, readStore)
        },
      },
      (doc, admission) => {
        if (!admission) throw new YjsAuthError(503, 'Yjs authorization is unavailable')
        if (!canAcceptConnection()) throw new YjsSessionAdmissionError(yjsSessionId)
        if (!awaitingAdmission) return
        const { accessMode, userId, descriptor } = admission
        const initialMessages = pendingMessages.splice(0)
        awaitingAdmission = false
        detachPendingListeners()
        try {
          setupWSConnection(ws, request, {
            doc,
            userId,
            accessMode,
            descriptor,
            initialMessages,
            persist: manualPersistenceHandler(accessMode, descriptor),
            onDocumentUpdate: livePersistenceHandler(accessMode, descriptor),
            onDocumentUpdateDebounceMs: SAVED_DOCUMENT_LIVE_PERSIST_DEBOUNCE_MS,
          })
          logger.info('Yjs connection established', { docId: yjsSessionId, userId })
        } catch (error) {
          rejectConnection(ws, error)
        }
      }
    )
  })().catch((error) => {
    if (!awaitingAdmission) return
    abandonPendingMessages()
    rejectConnection(ws, error)
  })
}

function copyWebSocketMessage(data: RawData): Uint8Array {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data
  return Uint8Array.from(bytes)
}

function yjsConnectionRejectionCode(error: unknown): number {
  if (error instanceof YjsSessionAdmissionError) {
    return YJS_CLOSE_CODE_RETRY_REQUIRED
  }
  const status = Number((error as { status?: unknown } | null)?.status)
  if (!Number.isInteger(status) || status < 400 || status >= 600) {
    return YJS_CLOSE_CODE_RETRY_REQUIRED
  }
  if (status === 403) return YJS_CLOSE_CODE_AUTHORIZATION_REVOKED
  if (status === 401 || status >= 500) return YJS_CLOSE_CODE_RETRY_REQUIRED
  return YJS_CLOSE_CODE_DOCUMENT_REJECTED
}

async function authenticateYjsUpgrade(pathSessionId: string, url: URL): Promise<DocumentAdmission> {
  const accessMode = parseAccessMode(url)
  const { userId, envelope } = await authenticateYjsConnection(url)

  if (envelope.sessionId !== pathSessionId) {
    throw new YjsAuthError(409, 'Session ID mismatch')
  }

  const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
  assertAccessModeAllowed(accessMode, descriptor)

  return { userId, accessMode, descriptor }
}

function parseAccessMode(url: URL): ReviewAccessMode {
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
  if (isListTarget && accessMode !== 'read') {
    throw new YjsAuthError(403, 'Entity-list websocket is read-only')
  }
  if (descriptor.entityKind === 'dashboard_layout' && accessMode !== 'read') {
    throw new YjsAuthError(403, 'Dashboard layout websocket is read-only')
  }
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
