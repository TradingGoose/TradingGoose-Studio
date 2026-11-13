import { afterEach, expect, it, vi } from 'vitest'
import { MAX_COPILOT_REQUEST_BYTES } from '@/lib/copilot/native/request-size'
import {
  listNativeHistory,
  listNativeThreads,
  postNativeCommand,
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
  const response = { status: 'history', threadId: 'thread', items: [message], pending: [pending] }
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body)).toEqual({
      command: 'history.read',
      workspaceId: null,
      threadId: 'thread',
    })
    return Response.json(response)
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await listNativeHistory(null, 'thread')).toEqual(response)
  expect(fetcher).toHaveBeenCalledOnce()
})
it('does not contact the server after cancellation', async () => {
  const abort = new AbortController()
  abort.abort(new Error('Cancelled'))
  vi.stubGlobal('fetch', vi.fn())
  await expect(listNativeHistory(null, 'thread', abort.signal)).rejects.toThrow('Cancelled')
  expect(fetch).not.toHaveBeenCalled()
})
it('does not send oversized native commands or serialized bodies', async () => {
  vi.stubGlobal('fetch', vi.fn())
  await expect(
    readNativeCommand({
      command: 'message',
      workspaceId: null,
      model: 'model',
      input: { content: '🦆'.repeat(MAX_COPILOT_REQUEST_BYTES / 4) },
    })
  ).rejects.toMatchObject({ status: 413 })
  expect(() => postNativeCommand('a'.repeat(MAX_COPILOT_REQUEST_BYTES + 1))).toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('sends the exact admitted serialized snapshot without re-encoding it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'threads', items: [] })))
  const body = '{ "command": "threads.list", "workspaceId": null }'
  await postNativeCommand(body)
  expect(fetch).toHaveBeenCalledWith('/api/copilot/native', expect.objectContaining({ body }))
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
