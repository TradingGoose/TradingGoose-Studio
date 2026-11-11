import { afterEach, expect, it, vi } from 'vitest'
import {
  listNativeHistory,
  listNativePending,
  listNativeThreads,
  readNativeCommand,
} from './native-api'

const at = '2026-11-08T00:00:00.000Z'
afterEach(() => vi.unstubAllGlobals())
it('loads every native thread in one authenticated request', async () => {
  const threads = Array.from({ length: 125 }, (_, i) => ({
    id: `thread-${i}`,
    title: '',
    createdAt: at,
    updatedAt: at,
  }))
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body)).toEqual({ command: 'threads.list', workspaceId: null })
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    return Response.json({ status: 'threads', items: threads })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await listNativeThreads(null)).toEqual(threads)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/copilot/native', expect.any(Object))
})
it('loads native message parts and public pending cards through the local service', async () => {
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
        status: request.command === 'history.read' ? 'history' : 'pending_targets',
        ...(request.command === 'history.read' ? { threadId: 'thread' } : {}),
        items: request.command === 'history.read' ? [message] : [pending],
      })
    })
  )
  expect(await listNativeHistory(null, 'thread')).toEqual([message])
  expect(await listNativePending(null, 'thread')).toEqual([pending])
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
          status: 'refused',
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied',
          },
        },
        { status: 403 }
      )
    })
  )
  await expect(
    readNativeCommand({
      command: 'threads.list',
      workspaceId: null,
    })
  ).rejects.toThrow('Access denied')
})
