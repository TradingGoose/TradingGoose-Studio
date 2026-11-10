import { afterEach, expect, it, vi } from 'vitest'
import { COPILOT_NATIVE_REVISION } from '@/lib/copilot/native/contract'
import {
  listNativeHistory,
  listNativePending,
  listNativeThreads,
  readNativeCommand,
} from './native-api'

const at = '2026-11-08T00:00:00.000Z'
afterEach(() => vi.unstubAllGlobals())
it('rejects a valid native mutation envelope returned for a cancel command', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      return Response.json({
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'updated',
        operation: 'thread.title',
        threadId: 'thread',
      })
    })
  )
  await expect(
    readNativeCommand({
      command: 'cancel',
      requestId: 'cancel-request',
      workspaceId: null,
      threadId: 'thread',
      runId: 'run',
    })
  ).rejects.toThrow('requested command')
})
it('buffers all official pages in order with exact nullable scope and no service credentials', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body))
    expect(request.workspaceId).toBeNull()
    expect(request.page.perPage).toBe(100)
    expect(init?.credentials).toBe('include')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    return Response.json({
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId: request.requestId,
      status: 'threads',
      page: request.page,
      hasMore: request.page.page === 0,
      items: [{ id: `thread-${request.page.page}`, title: '', createdAt: at, updatedAt: at }],
    })
  })
  vi.stubGlobal('fetch', fetcher)
  expect((await listNativeThreads(null)).map((thread) => thread.id)).toEqual([
    'thread-0',
    'thread-1',
  ])
  expect(fetcher.mock.calls.every(([url]) => url === '/api/copilot/native')).toBe(true)
})
it.each(['duplicate', 'wrong-page', 'empty-more', 'wrong-thread', 'wrong-request'])(
  'rejects %s before returning partial canonical history',
  async (mode) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body))
        return Response.json({
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId: mode === 'wrong-request' ? 'other' : request.requestId,
          status: 'history',
          threadId: mode === 'wrong-thread' ? 'other' : 'thread',
          page: mode === 'wrong-page' ? { page: 9, perPage: 100 } : request.page,
          hasMore: mode === 'duplicate' ? request.page.page === 0 : mode === 'empty-more',
          items:
            mode === 'empty-more'
              ? []
              : [
                  {
                    id: 'same',
                    role: 'user',
                    createdAt: at,
                    parts: [{ type: 'text', text: 'native' }],
                  },
                ],
        })
      })
    )
    await expect(listNativeHistory('workspace', 'thread')).rejects.toThrow()
  }
)
it('does not send a request after abort or mistake native refusal for an empty pending list', async () => {
  const abort = new AbortController()
  abort.abort()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(listNativePending(null, 'thread', abort.signal)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
  fetcher.mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    return Response.json(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId: request.requestId,
        status: 'refused',
        error: { code: 'FORBIDDEN', message: 'denied', retryable: false, uncertain: false },
      },
      { status: 403 }
    )
  })
  await expect(listNativePending(null, 'thread')).rejects.toThrow('denied')
})
