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
  }

  on(event: string, handler: (...args: any[]) => void) {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(handler)
    this.listeners.set(event, handlers)
  }

  emit(event: string, ...args: any[]) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args)
    }
  }
}

vi.mock('y-websocket', () => ({
  WebsocketProvider: MockWebsocketProvider,
}))

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
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

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(descriptor, { wsOrigin: 'ws://localhost:3002' })
    const provider = result.provider as unknown as MockWebsocketProvider

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

  it('refreshes the one-time token after a connection error', async () => {
    const tokens = ['token-1', 'token-2']

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
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

      throw new Error(`Unexpected fetch: ${url}`)
    })

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(descriptor, { wsOrigin: 'ws://localhost:3002' })
    const provider = result.provider as unknown as MockWebsocketProvider

    provider.emit('connection-error', new Event('error'), provider)
    await waitForCondition(() => {
      expect(provider.params.token).toBe('token-2')
      expect(provider.connect).toHaveBeenCalledTimes(2)
    })
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

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(descriptor, { wsOrigin: 'ws://localhost:3002' })
    const provider = result.provider as unknown as MockWebsocketProvider

    provider.shouldConnect = false
    provider.emit('connection-close', null, provider)
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')
  })

  it('retries token refresh instead of reconnecting with a stale token', async () => {
    vi.useFakeTimers()
    const tokens = ['token-1', 'token-2']

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/auth/socket-token') {
        const nextToken = tokens.shift()
        if (!nextToken) {
          throw new Error('temporary auth outage')
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

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(descriptor, { wsOrigin: 'ws://localhost:3002' })
    const provider = result.provider as unknown as MockWebsocketProvider

    provider.emit('connection-close', null, provider)
    await Promise.resolve()

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.params.token).toBe('token-1')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(provider.connect).toHaveBeenCalledTimes(2)
    expect(provider.params.token).toBe('token-2')

    consoleErrorSpy.mockRestore()
  })

  it('boots expired draft seeds without opening the websocket session', async () => {
    const draftDescriptor: ReviewTargetDescriptor = {
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      draftSessionId: 'draft-1',
      reviewSessionId: 'review-1',
      yjsSessionId: 'review-1',
    }
    const draftRuntime: ReviewTargetRuntimeState = {
      docState: 'expired',
      replaySafe: false,
      reseededFromCanonical: false,
    }

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.startsWith('/api/yjs/sessions/review-1/snapshot?')) {
        return new Response(
          JSON.stringify({
            snapshotBase64: '',
            descriptor: draftDescriptor,
            runtime: draftRuntime,
          }),
          {
            status: 410,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })

    const { bootstrapYjsProvider } = await import('./provider')
    const result = await bootstrapYjsProvider(draftDescriptor, {
      wsOrigin: 'ws://localhost:3002',
      draftSeed: {
        entityKind: 'skill',
        payload: {
          name: 'Recovered skill',
          description: 'Recovered description',
          content: 'Recovered content',
        },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/yjs/sessions/review-1/snapshot?')
    expect(result.runtime).toEqual(draftRuntime)
    expect(result.provider.connect).toHaveBeenCalledTimes(0)
    expect(result.provider.shouldConnect).toBe(false)

    const fields = result.doc.getMap('fields')
    expect(fields.get('name')).toBe('Recovered skill')
    expect(fields.get('description')).toBe('Recovered description')
    expect(fields.get('content')).toBe('Recovered content')
  })
})
