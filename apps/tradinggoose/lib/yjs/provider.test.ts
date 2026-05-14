/**
 * @vitest-environment jsdom
 */

import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewTargetDescriptor, ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

const fetchMock = vi.fn()

class MockWebsocketProvider {
  awareness = {}
  connect = vi.fn(() => {
    this.shouldConnect = true
  })
  destroy = vi.fn()
  disconnect = vi.fn(() => {
    this.shouldConnect = false
  })
  doc: Y.Doc
  listeners = new Map<string, Set<(...args: any[]) => void>>()
  params: Record<string, string>
  protocols: string[]
  roomname: string
  serverUrl: string
  shouldConnect = false
  synced = false
  ws: object | null = null

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    opts: {
      connect?: boolean
      params?: Record<string, string>
      protocols?: string[]
    } = {}
  ) {
    this.serverUrl = serverUrl
    this.roomname = roomname
    this.doc = doc
    this.params = opts.params ?? {}
    this.protocols = opts.protocols ?? []

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
    return { result, provider: result.provider as unknown as MockWebsocketProvider }
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

  it('refreshes the one-time token before reconnecting after a close', async () => {
    const tokens = ['token-1', 'token-2']

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: tokens.shift() })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        return jsonResponse({
          snapshotBase64: '',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })

    const { provider } = await bootstrapSyncedProvider()

    expect(provider.params.token).toBe('token-1')
    expect(provider.connect).toHaveBeenCalledTimes(1)

    provider.emit('connection-close', null, provider)
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
  })

  it('does not rotate the token after an intentional disconnect', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: 'token-1' })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        return jsonResponse({
          snapshotBase64: '',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { provider } = await bootstrapSyncedProvider()

    provider.shouldConnect = false
    provider.emit('connection-close', null, provider)
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')
  })

  it('retries token refresh instead of reconnecting with a stale token', async () => {
    const tokens = ['token-1', 'token-2']

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        const nextToken = tokens.shift()
        if (!nextToken) {
          throw new Error('auth outage')
        }
        return jsonResponse({ token: nextToken })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        return jsonResponse({
          snapshotBase64: '',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { provider } = await bootstrapSyncedProvider()

    expect(provider.params.accessMode).toBe('write')

    vi.useFakeTimers()

    provider.emit('connection-close', null, provider)
    await Promise.resolve()

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(provider.connect).toHaveBeenCalledTimes(2)
    expect(provider.params.token).toBe('token-2')
    expect(provider.params.accessMode).toBe('write')

    consoleErrorSpy.mockRestore()
  })

  it('requires write access on the snapshot request and waits for provider sync', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        return jsonResponse({ token: 'token-1' })
      }

      if (url.startsWith('/api/yjs/sessions/workflow-1/snapshot?')) {
        expect(url).toContain('accessMode=write')
        return jsonResponse({
          snapshotBase64: '',
          descriptor,
          runtime,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { result } = await bootstrapSyncedProvider()
    expect(result.provider).toBe(providerInstances[0])
    expect(providerInstances[0].params.accessMode).toBe('write')
  })

})
