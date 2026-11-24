/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelQueuedWorkflowExecution,
  observeQueuedWorkflowExecution,
  queueWorkflowExecution,
  WorkflowQueueAdmissionError,
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

  it.each([
    [429, 'PENDING_EXECUTION_LIMIT', true],
    [429, undefined, false],
    [429, 'DISPATCH_FAILED', false],
    [503, undefined, false],
  ] as const)(
    'classifies admission HTTP %s, code %s without inferring safety from status',
    async (status, code, refused) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ error: 'Queue unavailable', code }, { status }))
      )
      const error = await queueWorkflowExecution(runParams).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ message: 'Queue unavailable' })
      expect(error instanceof WorkflowQueueAdmissionError).toBe(refused)
    }
  )

  it('preserves a lost admission response as an uncertain failure', async () => {
    const error = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    await expect(queueWorkflowExecution(runParams)).rejects.toBe(error)
  })

  it('sends an explicit editor cancellation to its admitted task', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ status: 'cancelling' }))
    vi.stubGlobal('fetch', request)
    await cancelQueuedWorkflowExecution('admitted-job')
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/jobs/admitted-job', {
      method: 'DELETE',
      cache: 'no-store',
    })
  })

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
      const handle = await queueWorkflowExecution(runParams)
      await expect(
        observeQueuedWorkflowExecution(handle, { callbacks: { onEvent } })
      ).resolves.toEqual(result)
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

  it.each(['completed', 'paused'] as const)(
    'returns the %s result to the observer',
    async (status) => {
      const result = {
        success: true,
        ...(status === 'paused' ? { status } : {}),
        output: { value: 42 },
        logs: [],
      }
      const terminal = { ...started, type: `execution:${status}`, eventId: 2, data: { result } }
      const fetchMock = vi.fn().mockResolvedValueOnce(streamResponse(encode([started, terminal])))
      vi.stubGlobal('fetch', fetchMock)
      const onEvent = vi.fn()
      await expect(
        observeQueuedWorkflowExecution(
          { taskId: started.executionId, executionId: started.executionId },
          { callbacks: { onEvent } }
        )
      ).resolves.toEqual(result)
      expect(onEvent.mock.calls).toEqual([[started], [terminal]])
      expect(fetchMock).toHaveBeenCalledOnce()
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
    const handle = await queueWorkflowExecution({ ...runParams, native })
    await expect(
      observeQueuedWorkflowExecution(handle, { signal: controller.signal })
    ).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
