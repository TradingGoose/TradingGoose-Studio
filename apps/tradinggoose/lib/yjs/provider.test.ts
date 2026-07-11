/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import type { ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

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
  roomname: string
  serverUrl: string
  shouldConnect = false
  synced = false
  disableBc: boolean

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
  const descriptor = buildSavedEntityDescriptor('workflow', 'workflow-1', 'workspace-1')

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
    vi.unstubAllGlobals()
  })

  it('ends a provider lineage on connection loss without reconnecting the same document', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })

    const { provider } = await bootstrapSyncedProvider()

    expect(provider.params.token).toBe('token-1')
    expect(provider.disableBc).toBe(true)
    expect(provider.connect).toHaveBeenCalledTimes(1)

    provider.emit('connection-close', null, provider)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.shouldConnect).toBe(false)
    expect(provider.params.token).toBe('token-1')
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
