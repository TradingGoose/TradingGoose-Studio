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
    const result = await bootstrapPromise
    return {
      result,
      provider: result.provider as unknown as MockWebsocketProvider,
    }
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rebases unacknowledged local edits onto a fresh server history', async () => {
    const snapshots = ['Initial', 'Replacement'].map((name) => {
      const doc = new Y.Doc()
      const fields = doc.getMap('fields')
      fields.set('serverName', name)
      fields.set('acknowledged', name)
      fields.set('codeText', new Y.Text(name))
      fields.set('stableText', new Y.Text('stable'))
      fields.set('interleavedText', new Y.Text(name === 'Initial' ? '' : 'aba'))
      fields.set('prefixText', new Y.Text(name === 'Initial' ? 'abc' : 'abcY'))
      fields.set('runText', new Y.Text(name === 'Initial' ? 'aa' : 'baaa'))
      fields.set('replaceText', new Y.Text(name === 'Initial' ? 'aab' : 'baXb'))
      if (name === 'Initial') fields.set('deletedText', new Y.Text('hello'))
      fields.set('retypedText', name === 'Initial' ? new Y.Text('hello') : 42)
      fields.set('removed', name === 'Initial' ? true : 'Replacement')
      fields.set('settings', { local: 'Initial', server: name })
      const nested = new Y.Map<unknown>()
      nested.set('serverName', name)
      fields.set('nested', nested)
      const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
      doc.destroy()
      return update
    })
    const { result, provider } = await bootstrapSyncedProvider()
    provider.receive(createSyncUpdateMessage(Buffer.from(snapshots[0], 'base64')))
    const acknowledgedState = Y.encodeStateVector(result.doc)
    result.doc.getMap('fields').set('acknowledged', 'Acknowledged')
    provider.receive(createSyncUpdateMessage(Y.encodeStateAsUpdate(result.doc, acknowledgedState)))
    provider.emit('connection-close', null, provider)
    const fields = result.doc.getMap('fields')
    ;(fields.get('codeText') as Y.Text).insert(7, ' local')
    ;(fields.get('stableText') as Y.Text).insert(6, '!')
    ;(fields.get('interleavedText') as Y.Text).insert(0, 'aa')
    ;(fields.get('prefixText') as Y.Text).insert(0, 'X')
    ;(fields.get('runText') as Y.Text).insert(1, 'a')
    ;(fields.get('replaceText') as Y.Text).delete(0, 3)
    ;(fields.get('replaceText') as Y.Text).insert(0, 'baX')
    ;(fields.get('deletedText') as Y.Text).insert(5, '!')
    ;(fields.get('retypedText') as Y.Text).insert(5, '!')
    ;(fields.get('nested') as Y.Map<unknown>).set('offline', true)
    fields.set('settings', { local: 'Offline', server: 'Initial' })
    fields.delete('removed')

    const event = await result.lifecycle
    if (event.type !== 'resync-required') throw event.error
    const pending = event.pendingLocalEdits
    if (!pending) throw new Error('Expected pending local edits')
    result.dispose()
    const accepted = new Y.Doc()
    Y.applyUpdate(accepted, pending.current)
    const sameHistory = await bootstrapSyncedProvider(Y.encodeStateAsUpdate(accepted), pending)
    expect((sameHistory.result.doc.getMap('fields').get('prefixText') as Y.Text).toString()).toBe(
      'Xabc'
    )
    expect((sameHistory.result.doc.getMap('fields').get('replaceText') as Y.Text).toString()).toBe(
      'baX'
    )
    sameHistory.result.dispose()
    accepted.destroy()
    const concurrent = new Y.Doc()
    Y.applyUpdate(concurrent, pending.base)
    ;(concurrent.getMap('fields').get('codeText') as Y.Text).insert(0, 'Server ')
    const concurrentPrefix = concurrent.getMap('fields').get('prefixText') as Y.Text
    concurrentPrefix.insert(concurrentPrefix.length, 'Y')
    const merged = await bootstrapSyncedProvider(Y.encodeStateAsUpdate(concurrent), pending)
    expect((merged.result.doc.getMap('fields').get('codeText') as Y.Text).toString()).toBe(
      'Server Initial local'
    )
    expect((merged.result.doc.getMap('fields').get('prefixText') as Y.Text).toString()).toBe(
      'XabcY'
    )
    merged.result.dispose()
    concurrent.destroy()
    const replacement = await bootstrapSyncedProvider(Buffer.from(snapshots[1], 'base64'), pending)
    const rebased = replacement.result.doc.getMap('fields')
    expect(rebased.get('serverName')).toBe('Replacement')
    expect(rebased.get('acknowledged')).toBe('Replacement')
    expect((rebased.get('codeText') as Y.Text).toString()).toBe('Replacement')
    expect((rebased.get('stableText') as Y.Text).toString()).toBe('stable!')
    expect((rebased.get('interleavedText') as Y.Text).toString()).toBe('aba')
    expect((rebased.get('prefixText') as Y.Text).toString()).toBe('abcY')
    expect((rebased.get('runText') as Y.Text).toString()).toBe('baaa')
    expect((rebased.get('replaceText') as Y.Text).toString()).toBe('baXb')
    expect(rebased.has('deletedText')).toBe(false)
    expect(rebased.get('retypedText')).toBe(42)
    expect((rebased.get('nested') as Y.Map<unknown>).toJSON()).toEqual({
      serverName: 'Replacement',
      offline: true,
    })
    expect(rebased.get('settings')).toEqual({ local: 'Initial', server: 'Replacement' })
    expect(rebased.get('removed')).toBe('Replacement')
    replacement.result.dispose()
    expect(provider.connect).toHaveBeenCalledOnce()
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
})
