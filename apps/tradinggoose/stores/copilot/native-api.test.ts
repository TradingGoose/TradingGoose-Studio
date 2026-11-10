import { afterEach, expect, it, vi } from 'vitest'
import {
  listNativeHistory,
  listNativePending,
  listNativeThreads,
  readNativeCommand,
} from './native-api'

const at = '2026-11-08T00:00:00.000Z'
afterEach(() => vi.unstubAllGlobals())
it('loads complete local conversation pages and deduplicates repeated rows', async () => {
  const fetcher = vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body)
    expect(request.workspaceId).toBeNull()
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    return Response.json({
      requestId: request.requestId,
      status: 'threads',
      page: request.page,
      hasMore: request.page.page === 0,
      items: [
        { id: 'same', title: '', createdAt: at, updatedAt: at },
        { id: `thread-${request.page.page}`, title: '', createdAt: at, updatedAt: at },
      ],
    })
  })
  vi.stubGlobal('fetch', fetcher)
  expect((await listNativeThreads(null)).map((thread) => thread.id)).toEqual([
    'same',
    'thread-0',
    'thread-1',
  ])
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.every(([url]) => url === '/api/copilot/native')).toBe(true)
})
it('loads native message parts and public pending cards through local pagination', async () => {
  const pending = {
    target: {
      threadId: 'thread',
      resourceId: 'resource',
      runId: 'run',
      toolCallId: 'call',
      toolName: 'edit_workflow',
    },
    stage: 'result',
    originalArgs: { entityId: 'workflow' },
    preview: { requiresReview: true, reviewToken: 'review' },
  }
  const message = {
    id: 'message',
    role: 'assistant',
    createdAt: at,
    parts: [{ type: 'text', text: 'hello' }],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      return Response.json({
        requestId: request.requestId,
        status: request.command === 'history.read' ? 'history' : 'pending_targets',
        ...(request.command === 'history.read' ? { threadId: 'thread' } : {}),
        items: request.command === 'history.read' ? [message] : [pending],
        page: request.page,
        hasMore: false,
      })
    })
  )
  expect(await listNativeHistory(null, 'thread')).toEqual([message])
  expect(await listNativePending(null, 'thread')).toEqual([pending])
})
it('stops inconsistent empty pagination instead of looping', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      return Response.json({
        requestId: request.requestId,
        status: 'threads',
        items: [],
        page: request.page,
        hasMore: true,
      })
    })
  )
  await expect(listNativeThreads(null)).rejects.toThrow('empty page')
  expect(fetch).toHaveBeenCalledOnce()
})
it('does not contact the server after cancellation', async () => {
  const abort = new AbortController()
  abort.abort(new Error('Cancelled'))
  vi.stubGlobal('fetch', vi.fn())
  await expect(listNativeHistory(null, 'thread', abort.signal)).rejects.toThrow('Cancelled')
  expect(fetch).not.toHaveBeenCalled()
})
it('preserves local refusals as errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      return Response.json(
        {
          requestId: request.requestId,
          status: 'refused',
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied',
            retryable: false,
            uncertain: false,
          },
        },
        { status: 403 }
      )
    })
  )
  await expect(
    readNativeCommand({
      command: 'threads.list',
      requestId: 'request',
      workspaceId: null,
      page: { page: 0, perPage: 100 },
    })
  ).rejects.toThrow('Access denied')
})
