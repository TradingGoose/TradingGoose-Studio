import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { WebSocket, WebSocketServer } from 'ws'
import type * as Y from 'yjs'
import {
  buildReviewTargetDescriptorFromEnvelope,
  isEntityListSessionId,
  parseDashboardWidgetSessionId,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import type {
  ReviewAccessMode,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { readPersistedDashboardWidgetBinding } from '@/lib/dashboard-layouts/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import {
  readDashboardColorPairDocument,
  readDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { getEntityFields } from '@/lib/yjs/entity-session'
import {
  SavedEntityPersistenceError,
  saveDashboardColorPairYjsDocToDb,
  saveDashboardWidgetYjsDocToDb,
  saveSavedEntityYjsDocToDb,
} from '@/lib/yjs/server/apply-entity-state'
import { createSavedReviewTargetBootstrapUpdate } from '@/lib/yjs/server/bootstrap-review-target'
import { authenticateYjsConnection, YjsAuthError } from './auth'
import { reconcileEntityListSession, refreshActiveEntityListSession } from './entity-list-session'
import {
  type DocumentValidator,
  discardDocumentIfIdle,
  getDocument,
  isYjsSessionAdmissionBlocked,
  peekDocument,
  setupWSConnection,
} from './upstream-utils'

const logger = createLogger('YjsWsHandler')
const SAVED_DOCUMENT_LIVE_PERSIST_DEBOUNCE_MS = 1500

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
  return async (_docId: string, doc: Y.Doc) => {
    if (descriptor.entityKind === 'workflow') {
      await saveWorkflowYjsDocToDb(entityId, doc)
      return
    }
    if (!descriptor.workspaceId) {
      throw new SavedEntityPersistenceError(409, 'Yjs persistence workspace is required')
    }
    if (descriptor.entityKind === 'watchlist') {
      await saveSavedEntityYjsDocToDb('watchlist', entityId, descriptor.workspaceId, doc)
      await refreshActiveEntityListSession('watchlist', descriptor.workspaceId).catch(
        () => undefined
      )
      return
    }
    if (!descriptor.ownerUserId) {
      throw new SavedEntityPersistenceError(409, 'Dashboard persistence owner is required')
    }
    const scope = { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId }
    if (descriptor.entityKind === 'dashboard_widget') {
      await saveDashboardWidgetYjsDocToDb(descriptor.yjsSessionId, scope, doc)
    } else {
      await saveDashboardColorPairYjsDocToDb(descriptor.yjsSessionId, scope, doc)
    }
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
  const pathname = url.pathname
  const match = pathname.match(/^\/yjs\/([^/]+)$/)

  if (!match || !match[1]) {
    rejectUpgrade(socket, 400, 'Invalid Yjs path')
    return
  }

  const yjsSessionId = decodeURIComponent(match[1])
  if (!canAcceptConnection() || isYjsSessionAdmissionBlocked(yjsSessionId)) {
    rejectUpgrade(socket, 409, 'Yjs session is not accepting connections')
    return
  }

  void authenticateAndPrepareUpgrade(yjsSessionId, url)
    .then(
      ({ accessMode, bootstrapState, userId, resolvedSessionId, descriptor, validateDocument }) => {
        if (
          !canAcceptConnection() ||
          isYjsSessionAdmissionBlocked(resolvedSessionId, descriptor.workspaceId)
        ) {
          rejectUpgrade(socket, 409, 'Yjs session is not accepting connections')
          return
        }
        wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          try {
            logger.info('Yjs connection established', { docId: resolvedSessionId, userId })
            setupWSConnection(ws, request, {
              docId: resolvedSessionId,
              userId,
              accessMode,
              descriptor,
              gc: true,
              bootstrapState,
              onDocumentUpdate: livePersistenceHandler(accessMode, descriptor),
              onDocumentUpdateDebounceMs: SAVED_DOCUMENT_LIVE_PERSIST_DEBOUNCE_MS,
              validateDocument,
            })
          } catch (error) {
            logger.error('Failed to attach Yjs connection', { docId: resolvedSessionId, error })
            ws.close(4409, 'Failed to attach Yjs session')
          }
        })
      }
    )
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
  accessMode: ReviewAccessMode
  descriptor: ReviewTargetDescriptor
  validateDocument?: DocumentValidator
}> {
  const accessMode = parseAccessMode(url)
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
  const canonicalDescriptor: ReviewTargetDescriptor = {
    ...descriptor,
    workspaceId: access.workspaceId,
    ownerUserId:
      descriptor.entityKind === 'dashboard_layout' ||
      descriptor.entityKind === 'dashboard_widget' ||
      descriptor.entityKind === 'dashboard_color_pair'
        ? userId
        : null,
  }
  const validateDocument = await prepareDocumentValidator(canonicalDescriptor)

  let bootstrapState: Uint8Array | undefined
  const liveDoc = peekDocument(pathSessionId)
  let runtime = liveDoc ? getReviewTargetRuntimeState(liveDoc) : null
  if (isListTarget) {
    const acquired = getDocument(pathSessionId, true, undefined, canonicalDescriptor.workspaceId)
    const listDoc = acquired.doc
    try {
      await reconcileEntityListSession(
        listDoc,
        canonicalDescriptor.entityKind as ReviewEntityKind,
        canonicalDescriptor.workspaceId as string,
        canonicalDescriptor.ownerUserId ?? null
      )
    } catch (error) {
      if (acquired.created) discardDocumentIfIdle(listDoc)
      throw error
    }
    runtime = getReviewTargetRuntimeState(listDoc)
  } else if (!liveDoc && canonicalDescriptor.entityId) {
    const bootstrapped = await createSavedReviewTargetBootstrapUpdate(canonicalDescriptor)
    bootstrapState = bootstrapped.state
    runtime = bootstrapped.runtime
  }

  if (!runtime) {
    throw new YjsAuthError(409, 'Review target is not bootstrapped')
  }

  if (runtime.docState === 'expired') {
    throw new YjsAuthError(409, 'Review target expired')
  }
  return {
    bootstrapState,
    userId,
    resolvedSessionId: pathSessionId,
    accessMode,
    descriptor: canonicalDescriptor,
    validateDocument,
  }
}

async function prepareDocumentValidator(
  descriptor: ReviewTargetDescriptor
): Promise<DocumentValidator | undefined> {
  if (isEntityListSessionId(descriptor.yjsSessionId)) return undefined
  if (descriptor.entityKind === 'watchlist') return (doc) => void getEntityFields(doc, 'watchlist')
  if (descriptor.entityKind === 'dashboard_color_pair') {
    return readDashboardColorPairDocument
  }
  if (descriptor.entityKind !== 'dashboard_widget') return undefined
  if (!descriptor.workspaceId || !descriptor.ownerUserId || !descriptor.entityId) {
    throw new YjsAuthError(409, 'Dashboard widget owner scope is required')
  }
  const target = parseDashboardWidgetSessionId(descriptor.yjsSessionId)
  if (!target || target.identityId !== descriptor.entityId) {
    throw new YjsAuthError(409, 'Invalid dashboard widget session')
  }
  const { widgetKey } = await readPersistedDashboardWidgetBinding(
    { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId },
    target.layoutId,
    target.identityId
  )
  return (doc) => readDashboardWidgetDocument(doc, widgetKey)
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
