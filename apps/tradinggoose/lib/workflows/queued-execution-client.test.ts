/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observeQueuedWorkflowExecution,
  runQueuedWorkflowExecution,
} from './queued-execution-client'

const runParams = {
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  input: {},
  triggerType: 'manual' as const,
  executionTarget: 'live' as const,
}
const receipt = (taskId = 'execution-1') =>
  Response.json({ taskId, executionId: 'execution-1' }, { status: 202 })
const streamResponse = (body: ConstructorParameters<typeof Response>[0]) =>
  new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
const encode = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
const started = {
  type: 'execution:started',
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  timestamp: new Date().toISOString(),
  eventId: 1,
  data: { startTime: new Date().toISOString() },
}

describe('queued workflow observation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['close', 'error'])(
    'reconnects after stream %s and skips replayed event IDs',
    async (end) => {
      const result = { success: true, output: { answer: 'Finished after reconnect' }, logs: [] }
      const completed = { ...started, type: 'execution:completed', eventId: 2, data: { result } }
      let disconnect!: () => void
      const interrupted = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(encode([started])))
          disconnect = () =>
            end === 'error' ? controller.error(new Error('Connection lost')) : controller.close()
        },
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(receipt())
        .mockResolvedValueOnce(streamResponse(interrupted))
        .mockResolvedValueOnce(streamResponse(encode([started, completed])))
      vi.stubGlobal('fetch', fetchMock)
      const onEvent = vi.fn().mockImplementationOnce(() => disconnect())
      await expect(runQueuedWorkflowExecution(runParams, { onEvent })).resolves.toEqual(result)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/jobs/execution-1',
        expect.objectContaining({
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': '1' },
        })
      )
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/queue'))).toHaveLength(1)
      expect(onEvent.mock.calls).toEqual([[started], [completed]])
    }
  )

  it.each([
    ['data: invalid-json\n\n', /JSON/],
    [encode([{ ...started, executionId: 'another-run' }]), /identity/],
    [encode([{ ...started, type: 'execution:completed' }]), /final result/],
  ] as const)('rejects invalid events without reconnecting: %s', async (body, error) => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      observeQueuedWorkflowExecution({ taskId: 'existing', executionId: 'execution-1' })
    ).rejects.toThrow(error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([403, 501])('stops on permanent HTTP %s without queueing', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'Observation unavailable' }, { status }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      observeQueuedWorkflowExecution({ taskId: 'existing', executionId: 'execution-1' })
    ).rejects.toThrow('Observation unavailable')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/jobs/existing',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': '0' },
      })
    )
  })

  it('cancels the admitted job when its execution signal aborts', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/queue')) return receipt()
      if (init?.method === 'DELETE') return Response.json({ status: 'cancelling' })
      return streamResponse(
        new ReadableStream({
          start() {
            setTimeout(() => controller.abort(), 0)
          },
        })
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      runQueuedWorkflowExecution({ ...runParams, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/execution-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it.each(['fetch', 'stream'])(
    'detaches during %s without cancelling or enqueueing its job',
    async (phase) => {
      const controller = new AbortController()
      const cancel = vi.fn()
      const fetchMock = vi.fn(async () => {
        if (phase === 'fetch') controller.abort()
        return streamResponse(
          new ReadableStream({
            start() {
              if (phase === 'stream') setTimeout(() => controller.abort(), 0)
            },
            cancel,
          })
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        observeQueuedWorkflowExecution(
          { taskId: 'existing', executionId: 'execution-1' },
          { signal: controller.signal }
        )
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/jobs/existing',
        expect.objectContaining({
          headers: { Accept: 'text/event-stream', 'Last-Event-ID': '0' },
        })
      )
    }
  )

  it('waits for an in-flight admission before sending cancellation', async () => {
    const controller = new AbortController()
    let release!: () => void
    const admission = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/queue')) {
        expect(init?.signal).toBeUndefined()
        await admission
        return receipt('admitted-job')
      }
      expect(init?.method).toBe('DELETE')
      return Response.json({ status: 'cancelling' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const run = runQueuedWorkflowExecution({ ...runParams, signal: controller.signal })
    controller.abort()
    release()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/jobs/admitted-job',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it.each(['completed', 'paused'] as const)(
    'returns %s results and removes cancellation listeners',
    async (status) => {
      const controller = new AbortController()
      const result = {
        success: true,
        ...(status === 'paused' ? { status } : {}),
        output: { value: 42 },
        logs: [],
      }
      const terminal = { ...started, type: `execution:${status}`, eventId: 2, data: { result } }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(receipt())
        .mockResolvedValueOnce(streamResponse(encode([started, terminal])))
      vi.stubGlobal('fetch', fetchMock)
      const onEvent = vi.fn()
      await expect(
        runQueuedWorkflowExecution({ ...runParams, signal: controller.signal }, { onEvent })
      ).resolves.toEqual(result)
      expect(onEvent.mock.calls).toEqual([[started], [terminal]])
      controller.abort()
      await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it('preserves native admission scope and observes through the same SSE contract', async () => {
    const controller = new AbortController()
    const native = {
      workspaceId: 'workspace',
      target: {
        threadId: 'thread',
        resourceId: 'resource',
        runId: 'run',
        toolCallId: 'execution-1',
        toolName: 'run_workflow',
      },
    }
    const result = { success: true, output: { value: 42 }, logs: [] }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/queue')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          native,
          executionId: 'execution-1',
          triggerType: 'manual',
          stream: true,
        })
        return receipt()
      }
      expect(init?.signal).toBe(controller.signal)
      expect(init?.headers).toEqual({ Accept: 'text/event-stream', 'Last-Event-ID': '0' })
      return streamResponse(encode([{ ...started, type: 'execution:completed', data: { result } }]))
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      runQueuedWorkflowExecution({ ...runParams, native, signal: controller.signal })
    ).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
