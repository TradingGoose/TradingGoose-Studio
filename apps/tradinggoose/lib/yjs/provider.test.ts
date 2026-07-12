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
    replaySafe: true,
    reseededFromCanonical: false,
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
          snapshotBase64: snapshotRequest === 1 ? 'AAA=' : reconnectSnapshot,
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })

    const { result, provider } = await bootstrapSyncedProvider()
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
        if (snapshotRequest === 2) return jsonResponse({ error: 'Unavailable' }, 503)
        if (snapshotRequest === 4) {
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
    expect([snapshotRequest, tokenRequest, provider.connect.mock.calls.length]).toEqual([4, 2, 2])

    consoleErrorSpy.mockRestore()
  })

  it('returns read sessions immediately and leaves replacement to the session owner', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: 'token-1' })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        expect(url).toContain('accessMode=read')
        return jsonResponse({
          snapshotBase64: 'AAA=',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(descriptor, 'ws://localhost:3002', 'read')
    const provider = result.provider as unknown as MockWebsocketProvider

    expect(result.accessMode).toBe('read')
    expect(provider.shouldConnect).toBe(true)
    expect(provider.disableBc).toBe(false)
    expect(provider.synced).toBe(false)
    const tokenFetches = fetchMock.mock.calls.length

    provider.emit('connection-close', null, provider)
    provider.emit('connection-error', new Event('error'), provider)
    await expect(result.lifecycle).resolves.toEqual({ type: 'reader-disconnected' })

    expect(fetchMock).toHaveBeenCalledTimes(tokenFetches)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.disconnect).toHaveBeenCalledOnce()
    expect(provider.params.token).toBe('token-1')
    result.dispose()
  })

  it.each<[string, Record<string, any>]>([
    ['empty update', { snapshotBase64: '' }],
    ['invalid base64', { snapshotBase64: '%%%' }],
    ['expired runtime', { runtime: { docState: 'expired' } }],
    ['missing replay safety', { runtime: { replaySafe: undefined } }],
    ['invalid replay safety', { runtime: { replaySafe: 'yes' } }],
    ['missing reseed state', { runtime: { reseededFromCanonical: undefined } }],
    ['invalid reseed state', { runtime: { reseededFromCanonical: 'no' } }],
    ['missing kind', { descriptor: { entityKind: undefined } }],
    ['missing identity', { descriptor: { entityId: undefined } }],
    ['missing workspace', { descriptor: { entityKind: 'watchlist', workspaceId: undefined } }],
    ['missing dashboard owner', { descriptor: { entityKind: 'dashboard_layout' } }],
  ])('rejects a snapshot with %s before publishing a provider', async (_label, overrides) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshotBase64: overrides.snapshotBase64 ?? 'AAA=',
        descriptor: { ...descriptor, ...overrides.descriptor },
        runtime: { ...runtime, ...overrides.runtime },
      })
    )
    const { bootstrapYjsProvider } = await import('./provider')

    await expect(
      bootstrapYjsProvider(descriptor, 'ws://localhost:3002', 'read')
    ).rejects.toMatchObject({ retryable: false })
    expect([fetchMock.mock.calls.length, providerInstances.length]).toEqual([1, 0])
  })

  it('applies the canonical snapshot before creating the provider', async () => {
    const source = new Y.Doc()
    source.getMap('fields').set('name', 'Snapshot value')
    const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64')
    source.destroy()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/socket-token') return jsonResponse({ token: 'token-1' })
      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        return jsonResponse({ snapshotBase64, descriptor, runtime })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result, dispose } = await bootstrapSyncedProvider()

    expect(result.doc.getMap('fields').get('name')).toBe('Snapshot value')
    dispose()
  })
})
