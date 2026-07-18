/**
 * @vitest-environment jsdom
 */

import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'

const fetchMock = vi.fn()

class MockWebsocketProvider {
  connect = vi.fn(() => {
    this.shouldConnect = true
  })
  destroy = vi.fn()
  disconnect = vi.fn(() => {
    this.shouldConnect = false
  })
  doc: Y.Doc
  disableBc: boolean
  listeners = new Map<string, Set<(...args: any[]) => void>>()
  messageHandlers: Array<(...args: any[]) => void>
  params: Record<string, string>
  shouldConnect = false
  synced = false

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
    pendingLocalEdits?: import('./provider').YjsPendingLocalEdits
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

  it('rebases divergent local text edits onto a fresh server history', async () => {
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
    const initial = snapshot({
      text: new Y.Text('a'),
      blocks: blocks('Base A', 'Base B'),
      deleted: 'base',
      retyped: new Y.Text('base'),
      nested: nested('a', 'base'),
    })
    const result = await bootstrapSyncedProvider()
    const provider = result.provider as unknown as MockWebsocketProvider
    provider.receive(createSyncUpdateMessage(initial))
    const fields = result.doc.getMap('workflow')
    ;(fields.get('text') as Y.Text).insert(1, 'b')
    fields.set('blocks', blocks('Local A', 'Base B'))
    fields.set('deleted', 'intermediate')
    ;(fields.get('retyped') as Y.Text).insert(4, '!')
    ;(fields.get('nested') as Y.Map<unknown>).set('owned', 'b')
    const intermediate = Y.encodeStateAsUpdate(result.doc)
    ;(fields.get('text') as Y.Text).insert(2, 'c')
    fields.delete('deleted')
    ;(fields.get('nested') as Y.Map<unknown>).set('owned', 'c')
    provider.emit('connection-close', null, provider)
    const event = await result.lifecycle
    if (event.type !== 'resync-required') throw event.error
    const pending = event.pendingLocalEdits
    if (!pending) throw new Error('Expected pending local edits')
    result.dispose()
    const restarted = await bootstrapSyncedProvider(intermediate, pending)
    expect(restarted.doc.getMap('workflow').toJSON()).toEqual({
      text: 'abc',
      blocks: blocks('Local A', 'Base B'),
      retyped: 'base!',
      nested: { owned: 'c', foreign: 'base' },
    })
    restarted.dispose()
    const concurrent = snapshot({
      text: new Y.Text('aX'),
      blocks: blocks('Base A', 'Remote B'),
      deleted: 'intermediate',
      nested: nested('b', 'server'),
    })
    const merged = await bootstrapSyncedProvider(concurrent, pending)
    const mergedFields = merged.doc.getMap('workflow')
    expect((mergedFields.get('text') as Y.Text).toString()).toBe('abc')
    expect(mergedFields.has('deleted')).toBe(false)
    expect((mergedFields.get('nested') as Y.Map<unknown>).toJSON()).toEqual({
      owned: 'c',
      foreign: 'server',
    })
    expect(mergedFields.get('blocks')).toEqual(blocks('Local A', 'Remote B'))
    merged.dispose()
    const replacement = await bootstrapSyncedProvider(
      snapshot({
        text: new Y.Text('foreign'),
        deleted: 'foreign',
        retyped: 42,
        nested: nested('foreign', 'server'),
      }),
      pending
    )
    expect(replacement.doc.getMap('workflow').toJSON()).toEqual({
      text: 'abc',
      deleted: 'foreign',
      retyped: 42,
      nested: { owned: 'foreign', foreign: 'server' },
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
    provider.doc.getMap('fields').set('name', 'Authoritative value')
    provider.emit('sync', true)
    const result = await bootstrap

    expect(provider.params.accessMode).toBe('read')
    expect(result.doc.getMap('fields').get('name')).toBe('Authoritative value')
    const tokenFetches = fetchMock.mock.calls.length

    provider.emit('connection-close', null, provider)
    provider.emit('connection-error', new Event('error'), provider)
    await expect(result.lifecycle).resolves.toEqual({ type: 'resync-required' })

    expect(fetchMock).toHaveBeenCalledTimes(tokenFetches)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.disconnect).toHaveBeenCalledOnce()
    result.dispose()
  })

  it('terminates an oversized writer update instead of replaying it', async () => {
    const result = await bootstrapSyncedProvider()
    const provider = result.provider as unknown as MockWebsocketProvider
    result.doc.getMap('workflow').set('content', 'local edit')

    provider.emit('connection-close', { code: 1009 }, provider)

    await expect(result.lifecycle).resolves.toMatchObject({
      type: 'terminal-failure',
      error: { retryable: false },
    })
    expect(provider.disconnect).toHaveBeenCalledOnce()
    result.dispose()
  })
})
