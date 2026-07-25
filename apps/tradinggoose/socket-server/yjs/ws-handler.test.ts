/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawData, WebSocketServer } from 'ws'
import * as Y from 'yjs'
import {
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_RETRY_REQUIRED,
} from '@/lib/copilot/review-sessions/types'
import type { DocumentAdmission } from './upstream-utils'
import { handleYjsUpgrade } from './ws-handler'

const mocks = vi.hoisted(() => {
  class YjsAuthError extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message)
    }
  }
  class YjsSessionAdmissionError extends Error {
    constructor(_sessionId: string) {
      super('Yjs session is not accepting connections')
    }
  }
  return {
    YjsAuthError,
    YjsSessionAdmissionError,
    authenticate: vi.fn(),
    initialize: vi.fn(),
    bindList: vi.fn(),
    acquire: vi.fn(),
    setup: vi.fn(),
    persistStaged: vi.fn(),
    saveEntity: vi.fn(),
    refreshList: vi.fn(),
    close: vi.fn(),
  }
})

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))
vi.mock('./auth', () => ({
  authenticateYjsConnection: mocks.authenticate,
  YjsAuthError: mocks.YjsAuthError,
}))
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  initializeSavedReviewTargetDocument: mocks.initialize,
}))
vi.mock('@/lib/yjs/server/revocation-fence', () => ({
  YjsSessionAdmissionError: mocks.YjsSessionAdmissionError,
}))
vi.mock('./entity-list-session', () => ({
  bindEntityListSession: mocks.bindList,
  refreshActiveEntityListSession: mocks.refreshList,
}))
vi.mock('@/lib/workflows/db-helpers', () => ({ saveWorkflowYjsDocToDb: vi.fn() }))
vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  saveSavedEntityYjsDocToDb: mocks.saveEntity,
}))
vi.mock('./upstream-utils', () => ({
  acquireDocument: mocks.acquire,
  persistStagedDocuments: mocks.persistStaged,
  setupWSConnection: mocks.setup,
}))

type TestTarget = {
  sessionId: string
  entityKind: string
  entityId?: string | null
  targetKind?: 'entity' | 'entity_list' | 'review_session'
  workspaceId?: string
  ownerUserId?: string | null
  reviewSessionId?: string | null
  draftSessionId?: string | null
}

const readStore = { select: vi.fn() }
const documents = new Map<string, { doc: Y.Doc; seeded: boolean }>()
const tick = () => new Promise((resolve) => setImmediate(resolve))
const entityId = (target: TestTarget) =>
  target.entityId === undefined ? target.sessionId : target.entityId

function authentication(target: TestTarget) {
  return {
    userId: 'user-1',
    envelope: {
      targetKind: target.targetKind ?? 'entity',
      sessionId: target.sessionId,
      reviewSessionId: target.reviewSessionId ?? null,
      workspaceId: target.workspaceId ?? 'workspace-1',
      ownerUserId: target.ownerUserId ?? null,
      entityKind: target.entityKind,
      entityId: entityId(target),
      draftSessionId: target.draftSessionId ?? null,
    },
  }
}

function requestFor(target: TestTarget, accessMode: 'read' | 'write' = 'write') {
  const params = new URLSearchParams({
    token: 'test-token',
    accessMode,
    targetKind: target.targetKind ?? 'entity',
    sessionId: target.sessionId,
    entityKind: target.entityKind,
  })
  for (const [key, value] of Object.entries({
    entityId: entityId(target),
    workspaceId: target.workspaceId,
    ownerUserId: target.ownerUserId,
    reviewSessionId: target.reviewSessionId,
    draftSessionId: target.draftSessionId,
  })) {
    if (value) params.set(key, value)
  }
  return {
    url: `/yjs/${encodeURIComponent(target.sessionId)}?${params}`,
    headers: { host: 'localhost:3000' },
  } as IncomingMessage
}

function websocketServer(messages: RawData[] = [Buffer.from([0, 0])], maxPayload = 1024 * 1024) {
  const wss = Object.assign(new EventEmitter(), {
    options: { maxPayload },
    handleUpgrade: vi.fn((_request, _socket, _head, callback) => {
      const ws = Object.assign(new EventEmitter(), { close: mocks.close })
      callback(ws)
      messages.forEach((message) => ws.emit('message', message))
    }),
  })
  return wss as unknown as WebSocketServer & { handleUpgrade: ReturnType<typeof vi.fn> }
}

async function runUpgrade(
  target: TestTarget,
  options: {
    accessMode?: 'read' | 'write'
    bootstrap?: { workspaceId?: string | null; state: Uint8Array } | null
    messages?: RawData[]
    maxPayload?: number
  } = {}
) {
  const request = requestFor(target, options.accessMode)
  const wss = websocketServer(options.messages, options.maxPayload)
  mocks.authenticate.mockResolvedValue(authentication(target))
  if (options.bootstrap === null) {
    mocks.initialize.mockRejectedValue(
      Object.assign(new Error('Review target is not bootstrapped'), { status: 404 })
    )
  } else {
    mocks.initialize.mockResolvedValue({
      workspaceId: options.bootstrap?.workspaceId ?? target.workspaceId ?? 'workspace-1',
      state: options.bootstrap?.state ?? new Uint8Array([0, 0]),
    })
  }
  handleYjsUpgrade(wss, request, {} as Duplex, Buffer.alloc(0))
  await tick()
  return { request, wss }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const { doc } of documents.values()) doc.destroy()
  documents.clear()
  mocks.acquire.mockImplementation(
    async (
      sessionId: string,
      options: {
        admission?: DocumentAdmission
        initialize: (
          doc: Y.Doc,
          admission: DocumentAdmission | undefined,
          store: typeof readStore
        ) => Promise<{ state?: Uint8Array } | undefined> | { state?: Uint8Array } | undefined
      },
      use: (doc: Y.Doc, admission?: DocumentAdmission) => unknown
    ) => {
      const entry = documents.get(sessionId) ?? { doc: new Y.Doc(), seeded: false }
      documents.set(sessionId, entry)
      if (!entry.seeded) {
        const initialized = await options.initialize(entry.doc, options.admission, readStore)
        if (initialized?.state) Y.applyUpdate(entry.doc, initialized.state)
        entry.seeded = true
      }
      return use(entry.doc, options.admission)
    }
  )
  mocks.persistStaged.mockImplementation(
    async (targets: Array<{ doc: Y.Doc }>, persist: (docs: Y.Doc[]) => Promise<unknown>) =>
      persist(targets.map(({ doc }) => doc))
  )
  mocks.refreshList.mockResolvedValue(undefined)
})

describe('handleYjsUpgrade', () => {
  it('upgrades once before authentication and rejects shutdown races', async () => {
    const target = { sessionId: 'workflow-shutdown-race', entityKind: 'workflow' }
    let resolveAuthentication!: (value: unknown) => void
    mocks.authenticate.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthentication = resolve
      })
    )
    const wss = websocketServer()
    let accepting = true

    handleYjsUpgrade(wss, requestFor(target), {} as Duplex, Buffer.alloc(0), () => accepting)
    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.setup).not.toHaveBeenCalled()
    accepting = false
    resolveAuthentication(authentication(target))
    await tick()

    expect(mocks.close).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_RETRY_REQUIRED,
      'Failed to attach Yjs session'
    )
  })

  it('starts authentication only after upgrade and rejects invalid credentials', async () => {
    const target = { sessionId: 'workflow-invalid-token', entityKind: 'workflow' }
    mocks.authenticate.mockRejectedValue(new mocks.YjsAuthError(401, 'Invalid token'))

    const malformed = websocketServer()
    malformed.handleUpgrade.mockImplementation(() => undefined)
    handleYjsUpgrade(malformed, requestFor(target), {} as Duplex, Buffer.alloc(0))
    await tick()
    expect(malformed.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.authenticate).not.toHaveBeenCalled()

    const wss = websocketServer()
    handleYjsUpgrade(wss, requestFor(target), {} as Duplex, Buffer.alloc(0))
    await tick()

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_RETRY_REQUIRED,
      'Failed to attach Yjs session'
    )
  })

  it('buffers ordered widget messages until canonical bootstrap completes', async () => {
    const target = {
      sessionId: 'dashboard-widget:layout-1:widget-1',
      entityKind: 'dashboard_widget',
      entityId: 'widget-1',
      ownerUserId: 'user-1',
    }
    const messages = [Buffer.from([0, 0]), Buffer.from([1, 2, 3])]
    const { request, wss } = await runUpgrade(target, { messages })

    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ entityKind: 'dashboard_widget', entityId: 'widget-1' }),
      readStore
    )
    expect(mocks.setup).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        accessMode: 'write',
        initialMessages: messages.map((message) => Uint8Array.from(message)),
        onDocumentUpdate: expect.any(Function),
      })
    )
    const initialMessages = mocks.setup.mock.calls[0]?.[2].initialMessages as Uint8Array[]
    initialMessages.forEach((message, index) => {
      expect(message).not.toBe(messages[index])
    })
    expect(wss.handleUpgrade.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initialize.mock.invocationCallOrder[0]!
    )
  })

  it('rejects an oversized pre-admission frame before copying it', () => {
    const target = { sessionId: 'watchlist-oversized-frame', entityKind: 'watchlist' }
    const copy = vi.spyOn(Uint8Array, 'from')
    mocks.authenticate.mockReturnValue(new Promise(() => {}))

    handleYjsUpgrade(
      websocketServer([Buffer.alloc(2 * 1024 * 1024)]),
      requestFor(target),
      {} as Duplex,
      Buffer.alloc(0)
    )

    expect(copy).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledWith(1009, 'Yjs message exceeds transport payload limit')
    copy.mockRestore()
  })

  it('rejects an oversized fragmented frame before concatenating it', () => {
    const target = { sessionId: 'watchlist-oversized-fragments', entityKind: 'watchlist' }
    const concat = vi.spyOn(Buffer, 'concat')
    mocks.authenticate.mockReturnValue(new Promise(() => {}))

    handleYjsUpgrade(
      websocketServer([[Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024)]]),
      requestFor(target),
      {} as Duplex,
      Buffer.alloc(0)
    )

    expect(concat).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledWith(1009, 'Yjs message exceeds transport payload limit')
    concat.mockRestore()
  })

  it('closes cumulative pre-admission overflow without attaching it', async () => {
    const target = { sessionId: 'watchlist-overflow', entityKind: 'watchlist' }
    const messages = [Buffer.from([0, 0]), Buffer.from([1, 2, 3])]
    const { wss } = await runUpgrade(target, { messages, maxPayload: 4 })

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledWith(1009, 'Yjs message exceeds transport payload limit')
    expect(mocks.setup).not.toHaveBeenCalled()
  })

  it('closes zero-byte frame overflow without attaching it', async () => {
    const target = { sessionId: 'watchlist-frame-overflow', entityKind: 'watchlist' }
    const { wss } = await runUpgrade(target, {
      messages: Array.from({ length: 65 }, () => Buffer.alloc(0)),
    })

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledWith(1009, 'Yjs message exceeds transport payload limit')
    expect(mocks.setup).not.toHaveBeenCalled()
  })

  it.each([
    ['saved entity', { sessionId: 'watchlist-read', entityKind: 'watchlist' }],
    [
      'dashboard layout',
      {
        sessionId: 'layout-read',
        entityKind: 'dashboard_layout',
        ownerUserId: 'user-1',
      },
    ],
  ])('allows %s read-mode websocket upgrades', async (_label, target) => {
    const { request } = await runUpgrade(target, { accessMode: 'read' })

    expect(mocks.setup).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({ accessMode: 'read', onDocumentUpdate: undefined })
    )
  })

  it('binds entity-list reconciliation instead of entity bootstrap', async () => {
    const target = {
      sessionId: 'list:watchlist:workspace-1',
      entityKind: 'watchlist',
      entityId: null,
      targetKind: 'entity_list' as const,
    }
    const listDoc = new Y.Doc()
    documents.set(target.sessionId, { doc: listDoc, seeded: false })

    await runUpgrade(target, { accessMode: 'read' })

    expect(mocks.bindList).toHaveBeenCalledWith(listDoc, 'watchlist', 'workspace-1', null)
    expect(mocks.initialize).not.toHaveBeenCalled()
  })

  it('persists writable watchlists through their saved-document lifecycle', async () => {
    await runUpgrade({ sessionId: 'watchlist-write', entityKind: 'watchlist' })
    const persist = mocks.setup.mock.calls[0]?.[2].onDocumentUpdate
    const doc = new Y.Doc()

    await persist('watchlist-write', doc)

    expect(mocks.saveEntity).toHaveBeenCalledWith(
      'watchlist',
      'watchlist-write',
      'workspace-1',
      doc
    )
    expect(mocks.refreshList).toHaveBeenCalledWith('watchlist', 'workspace-1')
    doc.destroy()
  })

  it('persists manual entity documents and identity names together', async () => {
    await runUpgrade({ sessionId: 'skill-write', entityKind: 'skill' })
    const persist = mocks.setup.mock.calls[0]?.[2].persist
    const doc = new Y.Doc()

    await persist(doc, 'request-1', 'Renamed skill')

    expect(mocks.persistStaged).toHaveBeenCalledWith([{ doc }], expect.any(Function), 'request-1')
    expect(mocks.saveEntity).toHaveBeenCalledWith('skill', 'skill-write', 'workspace-1', doc, {
      identity: { name: 'Renamed skill' },
    })
    expect(mocks.refreshList).toHaveBeenCalledWith('skill', 'workspace-1')
    doc.destroy()
  })

  it('rejects writable dashboard layout sockets', async () => {
    await runUpgrade({
      sessionId: 'layout-write',
      entityKind: 'dashboard_layout',
      ownerUserId: 'user-1',
    })

    expect(mocks.setup).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledWith(4403, 'Failed to attach Yjs session')
  })

  it.each([
    [YJS_CLOSE_CODE_AUTHORIZATION_REVOKED, new mocks.YjsAuthError(403, 'Forbidden')],
    [YJS_CLOSE_CODE_RETRY_REQUIRED, new mocks.YjsSessionAdmissionError('watchlist-fenced')],
  ])('maps acquisition failures to close code %i', async (closeCode, error) => {
    mocks.acquire.mockRejectedValueOnce(error)
    const { wss } = await runUpgrade({
      sessionId: 'watchlist-fenced',
      entityKind: 'watchlist',
    })

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledWith(closeCode, 'Failed to attach Yjs session')
  })

  it('maps setup failures without attempting another upgrade', async () => {
    mocks.setup.mockImplementationOnce(() => {
      throw new Error('setup failed')
    })
    const { wss } = await runUpgrade({
      sessionId: 'watchlist-setup-failed',
      entityKind: 'watchlist',
    })

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_RETRY_REQUIRED,
      'Failed to attach Yjs session'
    )
  })

  it('rejects missing non-entity review sessions', async () => {
    await runUpgrade(
      {
        sessionId: 'review-unbootstrapped',
        entityKind: 'skill',
        entityId: null,
        targetKind: 'review_session',
        workspaceId: 'workspace-3',
        reviewSessionId: 'review-unbootstrapped',
        draftSessionId: 'draft-1',
      },
      { bootstrap: null }
    )

    expect(mocks.close).toHaveBeenCalledWith(4410, 'Failed to attach Yjs session')
  })
})
