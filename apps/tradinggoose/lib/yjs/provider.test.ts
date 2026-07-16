/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type {
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'

const fetchMock = vi.fn()

class MockWebsocketProvider {
  awareness = {}
  connect = vi.fn(() => {
    this.shouldConnect = true
    this.ws = {}
  })
  destroy = vi.fn()
  disconnect = vi.fn(() => {
    this.shouldConnect = false
    this.ws = null
  })
  doc: Y.Doc
  listeners = new Map<string, Set<(...args: any[]) => void>>()
  params: Record<string, string>
  protocols: string[]
  roomname: string
  serverUrl: string
  shouldConnect = false
  synced = false
  disableBc: boolean
  ws: object | null = null

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    opts: {
      connect?: boolean
      disableBc?: boolean
      params?: Record<string, string>
      protocols?: string[]
    } = {}
  ) {
    this.serverUrl = serverUrl
    this.roomname = roomname
    this.doc = doc
    this.params = opts.params ?? {}
    this.protocols = opts.protocols ?? []
    this.disableBc = opts.disableBc ?? false

    if (opts.connect !== false) {
      this.connect()
    }
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
}

const providerInstances: MockWebsocketProvider[] = []

vi.mock('y-websocket', () => ({
  WebsocketProvider: MockWebsocketProvider,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function waitForCondition(assertion: () => void, timeoutMs = 1000) {
  const start = Date.now()

  while (true) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
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

  const runtime: ReviewTargetRuntimeState = {
    docState: 'active',
  }

  async function bootstrapSyncedProvider() {
    const { bootstrapYjsProvider } = await import('./provider')
    const bootstrapPromise = bootstrapYjsProvider(descriptor, 'ws://localhost:3002')
    await waitForCondition(() => {
      expect(providerInstances).toHaveLength(1)
    })
    providerInstances[0].emit('sync', true)
    const result = await bootstrapPromise
    return {
      result,
      provider: result.provider as unknown as MockWebsocketProvider,
      dispose: result.dispose,
    }
  }

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    providerInstances.length = 0
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reauthorizes before reconnecting and terminates an offline-revoked writer', async () => {
    const tokens = ['token-1', 'token-2']
    const reconnectSource = new Y.Doc()
    reconnectSource.getMap('fields').set('seed', true)
    const initialUpdate = Y.encodeStateAsUpdate(reconnectSource)
    reconnectSource.getMap('fields').set('server-only', true)
    const reconnectSnapshot = Buffer.from(Y.encodeStateAsUpdate(reconnectSource)).toString('base64')
    reconnectSource.destroy()
    let snapshotRequest = 0
    let revoked = false

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: tokens.shift() })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        expect(url).toContain('accessMode=write')
        if (revoked) return jsonResponse({ error: 'Forbidden' }, 403)
        snapshotRequest += 1
        return jsonResponse({
          snapshotBase64: reconnectSnapshot,
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })

    const { result, provider } = await bootstrapSyncedProvider()
    Y.applyUpdate(result.doc, initialUpdate)
    result.doc.getMap('fields').set('offline-edit', true)

    expect(provider.params.token).toBe('token-1')
    expect(provider.disableBc).toBe(false)
    expect(provider.connect).toHaveBeenCalledTimes(1)

    provider.emit('connection-close', null, provider)
    provider.emit('connection-error', new Event('error'), provider)
    await waitForCondition(() => {
      expect(provider.params.token).toBe('token-2')
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/socket-token', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })
    expect(provider.connect).toHaveBeenCalledTimes(2)
    expect(result.doc.getMap('fields').get('offline-edit')).toBe(true)
    expect(result.doc.getMap('fields').has('server-only')).toBe(false)
    const requestsBeforeClose = fetchMock.mock.calls.length
    revoked = true

    provider.emit('connection-close', null, provider)
    await waitForCondition(() => expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeClose + 1))
    await waitForCondition(() => expect(provider.disconnect).toHaveBeenCalledOnce())
    await expect(result.lifecycle).resolves.toEqual({
      type: 'terminal-failure',
      error: expect.objectContaining({ retryable: false }),
    })
    expect(provider.shouldConnect).toBe(false)
    expect(provider.connect).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeClose + 1)

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeClose + 1)
  })

  it('requires a fresh bootstrap when the server snapshot has unrelated history', async () => {
    const snapshots = ['Initial', 'Replacement'].map((name) => {
      const doc = new Y.Doc()
      doc.getMap('fields').set('name', name)
      const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
      doc.destroy()
      return update
    })
    let snapshotRequest = 0

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/socket-token') return jsonResponse({ token: 'token-1' })
      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        snapshotRequest += 1
        return jsonResponse({
          snapshotBase64: snapshots[1],
          descriptor,
          runtime,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result, provider } = await bootstrapSyncedProvider()
    Y.applyUpdate(result.doc, Buffer.from(snapshots[0], 'base64'))
    result.doc.getMap('fields').set('offline-edit', true)
    provider.emit('connection-close', null, provider)

    await expect(result.lifecycle).resolves.toEqual({ type: 'resync-required' })
    expect(provider.connect).toHaveBeenCalledOnce()
  })

  it('ignores a late token refresh after provider disposal', async () => {
    let tokenRequest = 0
    let resolveRefresh!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/socket-token') {
        tokenRequest += 1
        return tokenRequest === 1 ? jsonResponse({ token: 'token-1' }) : refresh
      }
      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        return jsonResponse({ snapshotBase64: 'AAA=', descriptor, runtime })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result, dispose, provider } = await bootstrapSyncedProvider()
    provider.emit('connection-close', null, provider)
    await waitForCondition(() => expect(tokenRequest).toBe(2))

    dispose()
    let lifecycleSettled = false
    void result.lifecycle.then(() => {
      lifecycleSettled = true
    })
    resolveRefresh(jsonResponse({ token: 'token-2' }))
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')
    expect(lifecycleSettled).toBe(false)
  })

  it('retries transient reauthorization before fetching a fresh token', async () => {
    let tokenRequest = 0
    let snapshotRequest = 0

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        tokenRequest += 1
        return jsonResponse({ token: tokenRequest === 1 ? 'token-1' : 'token-2' })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        snapshotRequest += 1
        if (snapshotRequest === 1) return jsonResponse({ error: 'Unavailable' }, 503)
        if (snapshotRequest === 3) {
          return jsonResponse({ snapshotBase64: 'AQID', descriptor, runtime })
        }
        return jsonResponse({
          snapshotBase64: 'AAA=',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result, provider } = await bootstrapSyncedProvider()

    expect(provider.params.accessMode).toBe('write')

    vi.useFakeTimers()

    provider.emit('connection-close', null, provider)
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(provider.connect).toHaveBeenCalledTimes(2)
    expect(provider.params.token).toBe('token-2')
    expect(provider.params.accessMode).toBe('write')

    provider.emit('connection-close', null, provider)
    await expect(result.lifecycle).resolves.toEqual({
      type: 'terminal-failure',
      error: expect.objectContaining({ retryable: false }),
    })
    expect([snapshotRequest, tokenRequest, provider.connect.mock.calls.length]).toEqual([3, 2, 2])

    consoleErrorSpy.mockRestore()
  })

  it('waits for authoritative reader sync without applying the HTTP snapshot', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: 'token-1' })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { bootstrapYjsProvider } = await import('./provider')
    const bootstrap = bootstrapYjsProvider(descriptor, 'ws://localhost:3002', 'read')
    await waitForCondition(() => expect(providerInstances).toHaveLength(1))
    const provider = providerInstances[0]

    expect(provider.shouldConnect).toBe(true)
    expect(provider.disableBc).toBe(false)
    expect(provider.synced).toBe(false)
    expect(provider.doc.getMap('fields').get('name')).toBeUndefined()
    provider.doc.getMap('fields').set('name', 'Authoritative value')
    provider.emit('sync', true)
    const result = await bootstrap

    expect(result.accessMode).toBe('read')
    expect(result.doc.getMap('fields').get('name')).toBe('Authoritative value')
    const tokenFetches = fetchMock.mock.calls.length

    provider.emit('connection-close', null, provider)
    provider.emit('connection-error', new Event('error'), provider)
    await expect(result.lifecycle).resolves.toEqual({ type: 'resync-required' })

    expect(fetchMock).toHaveBeenCalledTimes(tokenFetches)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.disconnect).toHaveBeenCalledOnce()
    expect(provider.params.token).toBe('token-1')
    result.dispose()
  })

  it('uses websocket admission as the sole initial history owner', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/socket-token') return jsonResponse({ token: 'token-1' })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result, provider, dispose } = await bootstrapSyncedProvider()

    expect(result.descriptor).toEqual(descriptor)
    expect(result.doc.getMap('fields').size).toBe(0)
    expect(provider.params).toMatchObject({ accessMode: 'write', entityId: 'workflow-1' })
    expect(fetchMock).toHaveBeenCalledOnce()
    dispose()
  })
})
