/**
 * @vitest-environment jsdom
 */

import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  decodeYjsLifecycleMessage,
  encodeYjsDurableCheckpoint,
  encodeYjsPersistError,
} from '@/lib/yjs/lifecycle-protocol'

const fetchMock = vi.fn()

class MockWebsocketProvider {
  connect = vi.fn(() => {
    this.shouldConnect = true
    this.wsconnected = true
  })
  destroy = vi.fn()
  disconnect = vi.fn(() => {
    this.shouldConnect = false
    this.wsconnected = false
  })
  doc: Y.Doc
  disableBc: boolean
  listeners = new Map<string, Set<(...args: any[]) => void>>()
  messageHandlers: Array<(...args: any[]) => void>
  params: Record<string, string>
  shouldConnect = false
  synced = false
  ws = { send: vi.fn() }
  wsconnected = false

  constructor(
    _serverUrl: string,
    _roomname: string,
    doc: Y.Doc,
    opts: {
      connect?: boolean
      disableBc?: boolean
      params?: Record<string, string>
    } = {}
  ) {
    this.doc = doc
    this.disableBc = opts.disableBc ?? false
    this.params = opts.params ?? {}
    this.messageHandlers = [
      (encoder, decoder, provider, emitSynced) => {
        const messageType = syncProtocol.readSyncMessage(decoder, encoder, provider.doc, provider)
        if (emitSynced && messageType === syncProtocol.messageYjsSyncStep2) {
          provider.emit('sync', true)
        }
      },
    ]

    if (opts.connect !== false) this.connect()
    providerInstances.push(this)
  }

  on(event: string, handler: (...args: any[]) => void) {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(handler)
    this.listeners.set(event, handlers)
  }

  off(event: string, handler: (...args: any[]) => void) {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event: string, ...args: any[]) {
    if (event === 'sync') {
      this.synced = args[0] === true
    }
    if (event === 'connection-close') {
      this.synced = false
      this.wsconnected = false
    }
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args)
    }
  }

  receive(message: Uint8Array) {
    const decoder = decoding.createDecoder(message)
    const encoder = encoding.createEncoder()
    const messageType = decoding.readVarUint(decoder)
    this.messageHandlers[messageType]?.(encoder, decoder, this, true, messageType)
  }
}

const providerInstances: MockWebsocketProvider[] = []

vi.mock('y-websocket', () => ({
  messageSync: 0,
  WebsocketProvider: MockWebsocketProvider,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createSyncUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

function readLifecycleMessage(message: Uint8Array) {
  const decoder = decoding.createDecoder(message)
  decoding.readVarUint(decoder)
  return decodeYjsLifecycleMessage(decoder)
}

describe('bootstrapYjsProvider', () => {
  const descriptor: ReviewTargetDescriptor = {
    workspaceId: 'workspace-1',
    entityKind: 'workflow',
    entityId: 'workflow-1',
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: 'workflow-1',
  }

  async function bootstrapSyncedProvider(
    serverUpdate?: Uint8Array,
    pendingLocalEdits?: import('./provider').YjsPendingLocalEdits,
    lineageId = 'lineage-1'
  ) {
    const { bootstrapYjsProvider } = await import('./provider')
    const providerCount = providerInstances.length + 1
    const bootstrapPromise = bootstrapYjsProvider(
      descriptor,
      'ws://localhost:3002',
      'write',
      pendingLocalEdits
    )
    await vi.waitFor(() => {
      expect(providerInstances).toHaveLength(providerCount)
    })
    const provider = providerInstances.at(-1)!
    const checkpointDoc = new Y.Doc()
    if (serverUpdate) Y.applyUpdate(checkpointDoc, serverUpdate)
    provider.receive(encodeYjsDurableCheckpoint(lineageId, Y.snapshot(checkpointDoc)))
    checkpointDoc.destroy()
    if (serverUpdate) provider.receive(createSyncUpdateMessage(serverUpdate))
    provider.emit('sync', true)
    return bootstrapPromise
  }

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    providerInstances.length = 0
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/socket-token') return jsonResponse({ token: 'token-1' })
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rebases pending local edits onto a fresh server history', async () => {
    const snapshot = (values: Record<string, unknown>) => {
      const doc = new Y.Doc()
      const fields = doc.getMap('workflow')
      for (const [key, value] of Object.entries(values)) fields.set(key, value)
      const update = Y.encodeStateAsUpdate(doc)
      doc.destroy()
      return update
    }
    const nested = (owned: string, foreign: string) => new Y.Map(Object.entries({ owned, foreign }))
    const blocks = (blockA: string, blockB: string) => ({
      blockA: { id: 'blockA', name: blockA },
      blockB: { id: 'blockB', name: blockB },
    })
    const edge = (id: string) => ({ id, source: `${id}-source`, target: `${id}-target` })
    const layout = (ids: string[]) => ({
      id: 'group',
      children: ids.map((id) => ({ id })),
      sizes: ids.map((_, index) => index + 1),
    })
    const initial = snapshot({
      text: new Y.Text('a'),
      same: new Y.Text('ab'),
      blocks: blocks('Base A', 'Base B'),
      edges: [edge('B')],
      layout: layout(['B']),
      positional: ['base'],
      deleted: 'base',
      nested: nested('a', 'base'),
    })
    const result = await bootstrapSyncedProvider()
    const provider = result.provider as unknown as MockWebsocketProvider
    provider.receive(createSyncUpdateMessage(initial))
    const fields = result.doc.getMap('workflow')
    let acknowledgedUpdate!: Uint8Array
    result.doc.once('update', (update) => {
      acknowledgedUpdate = update
    })
    ;(fields.get('text') as Y.Text).insert(1, 'b')
    provider.receive(createSyncUpdateMessage(acknowledgedUpdate))
    fields.set('blocks', blocks('Local A', 'Base B'))
    fields.set('deleted', 'intermediate')
    ;(fields.get('nested') as Y.Map<unknown>).set('owned', 'b')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(result.doc))
    remote.getMap('workflow').set('retyped', new Y.Text('base'))
    const intermediate = Y.encodeStateAsUpdate(remote)
    provider.receive(
      createSyncUpdateMessage(Y.encodeStateAsUpdate(remote, Y.encodeStateVector(result.doc)))
    )
    remote.destroy()
    fields.set('edges', [edge('B'), edge('L')])
    fields.set('layout', layout(['B', 'L']))
    fields.set('positional', ['local'])
    ;(fields.get('retyped') as Y.Text).insert(4, '!')
    ;(fields.get('text') as Y.Text).insert(2, 'c')
    fields.delete('deleted')
    ;(fields.get('nested') as Y.Map<unknown>).set('owned', 'c')
    provider.receive(encodeYjsDurableCheckpoint('lineage-2', Y.emptySnapshot))
    const stale = snapshot({ stale: true })
    provider.receive(createSyncUpdateMessage(stale))
    expect(fields.has('stale')).toBe(false)
    const event = await result.lifecycle
    if (event.type !== 'lineage-replaced') throw event.error
    const pending = event.pendingLocalEdits
    if (!pending) throw new Error('Expected pending local edits')
    expect(pending.replay).toHaveLength(12)
    expect(pending.replay[0]).toEqual({ local: true, update: acknowledgedUpdate })
    result.dispose()
    const restarted = await bootstrapSyncedProvider(intermediate, pending, 'lineage-2')
    expect(restarted.doc.getMap('workflow').toJSON()).toEqual({
      text: 'abc',
      same: 'ab',
      blocks: blocks('Local A', 'Base B'),
      edges: [edge('B'), edge('L')],
      layout: layout(['B', 'L']),
      positional: ['local'],
      retyped: 'base!',
      nested: { owned: 'c', foreign: 'base' },
    })
    ;(restarted.doc.getMap('workflow').get('same') as Y.Text).insert(1, 'X')
    const restartedProvider = restarted.provider as unknown as MockWebsocketProvider
    restartedProvider.receive(encodeYjsDurableCheckpoint('lineage-3', Y.emptySnapshot))
    const repeatedEvent = await restarted.lifecycle
    if (repeatedEvent.type !== 'lineage-replaced') throw repeatedEvent.error
    const replayedPending = repeatedEvent.pendingLocalEdits
    restarted.dispose()
    const concurrent = snapshot({
      text: new Y.Text('aX'),
      same: new Y.Text('aXb'),
      blocks: blocks('Local A', 'Remote B'),
      edges: [edge('B'), edge('R')],
      layout: layout(['B', 'R']),
      positional: ['remote'],
      deleted: 'intermediate',
      nested: nested('b', 'server'),
    })
    const merged = await bootstrapSyncedProvider(concurrent, replayedPending, 'lineage-3')
    const mergedFields = merged.doc.getMap('workflow')
    expect((mergedFields.get('text') as Y.Text).toString()).toBe('aXc')
    expect((mergedFields.get('same') as Y.Text).toString()).toBe('aXXb')
    expect(mergedFields.has('deleted')).toBe(false)
    expect((mergedFields.get('nested') as Y.Map<unknown>).toJSON()).toEqual({
      owned: 'c',
      foreign: 'server',
    })
    expect(mergedFields.get('blocks')).toEqual(blocks('Local A', 'Remote B'))
    expect(mergedFields.get('edges')).toEqual([edge('B'), edge('R'), edge('L')])
    expect(mergedFields.get('layout')).toEqual(layout(['B', 'R']))
    expect(mergedFields.get('positional')).toEqual(['remote'])
    merged.dispose()
    const replacement = await bootstrapSyncedProvider(
      snapshot({
        text: new Y.Text('foreign'),
        deleted: 'foreign',
        retyped: 42,
        nested: nested('foreign', 'server'),
      }),
      pending,
      'lineage-4'
    )
    expect(replacement.doc.getMap('workflow').toJSON()).toEqual({
      text: 'foreignbc',
      deleted: 'foreign',
      retyped: 42,
      nested: { owned: 'foreign', foreign: 'server' },
    })
    const replacementFields = replacement.doc.getMap('workflow')
    replacementFields.set('checkpointed', true)
    const requested = new Y.Doc()
    Y.applyUpdate(requested, Y.encodeStateAsUpdate(replacement.doc))
    const replacementProvider = replacement.provider as unknown as MockWebsocketProvider
    const persisted = replacement.persist('Renamed workflow')
    replacementFields.set('after-request', true)
    const persistRequest = readLifecycleMessage(replacementProvider.ws.send.mock.calls[0]![0])
    if (persistRequest.type !== 'persist-request') throw new Error('Expected persist request')
    expect(persistRequest.identityName).toBe('Renamed workflow')
    replacementProvider.receive(
      encodeYjsDurableCheckpoint('lineage-4', Y.snapshot(requested), persistRequest.requestId)
    )
    requested.destroy()
    await expect(persisted).resolves.toBeUndefined()

    const failed = replacement.persist()
    const failedRequest = readLifecycleMessage(replacementProvider.ws.send.mock.calls[1]![0])
    if (failedRequest.type !== 'persist-request') throw new Error('Expected persist request')
    replacementProvider.receive(
      encodeYjsPersistError(failedRequest.requestId, 'database unavailable')
    )
    await expect(failed).rejects.toThrow('database unavailable')

    replacementFields.delete('checkpointed')
    replacementProvider.receive(
      encodeYjsDurableCheckpoint('lineage-4', Y.snapshot(replacement.doc))
    )
    replacementProvider.receive(encodeYjsDurableCheckpoint('lineage-5', Y.emptySnapshot))
    await expect(replacement.lifecycle).resolves.toEqual({
      type: 'lineage-replaced',
      pendingLocalEdits: undefined,
    })
    replacement.dispose()
  })

  it('waits for authoritative reader sync without applying the HTTP snapshot', async () => {
    const { bootstrapYjsProvider } = await import('./provider')
    const bootstrap = bootstrapYjsProvider(descriptor, 'ws://localhost:3002', 'read')
    await vi.waitFor(() => expect(providerInstances).toHaveLength(1))
    const provider = providerInstances[0]

    expect(provider.shouldConnect).toBe(true)
    expect(provider.disableBc).toBe(true)
    expect(provider.synced).toBe(false)
    expect(provider.doc.getMap('fields').get('name')).toBeUndefined()
    const server = new Y.Doc()
    server.getMap('fields').set('name', 'Authoritative value')
    provider.receive(encodeYjsDurableCheckpoint('lineage-1', Y.snapshot(server)))
    provider.receive(createSyncUpdateMessage(Y.encodeStateAsUpdate(server)))
    server.destroy()
    provider.emit('sync', true)
    const result = await bootstrap

    expect(provider.params.accessMode).toBe('read')
    expect(result.doc.getMap('fields').get('name')).toBe('Authoritative value')
    const tokenFetches = fetchMock.mock.calls.length

    provider.emit('connection-close', null, provider)
    await vi.waitFor(() => expect(provider.connect).toHaveBeenCalledTimes(2))

    expect(fetchMock).toHaveBeenCalledTimes(tokenFetches + 1)
    expect(provider.disconnect).not.toHaveBeenCalled()
    expect(result.doc).toBe(provider.doc)

    let resolveToken!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve
        })
    )
    provider.emit('connection-close', null, provider)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(tokenFetches + 2))
    result.dispose()
    resolveToken(jsonResponse({ token: 'token-2' }))
    await Promise.resolve()

    expect(provider.connect).toHaveBeenCalledTimes(2)
  })

  it('terminates an oversized writer update instead of replaying it', async () => {
    const result = await bootstrapSyncedProvider()
    const provider = result.provider as unknown as MockWebsocketProvider
    result.doc.getMap('workflow').set('content', 'local edit')
    const persistence = result.persist()

    provider.emit('connection-close', { code: 1009 }, provider)

    await expect(persistence).rejects.toThrow('connection closed')
    await expect(result.lifecycle).resolves.toMatchObject({
      type: 'terminal-failure',
      error: { retryable: false },
    })
    expect(provider.disconnect).toHaveBeenCalledOnce()
    result.dispose()
  })
})
